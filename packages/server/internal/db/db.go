package db

import (
	"context"
	"crypto/tls"
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

type DB struct {
	Postgres *sql.DB
	Redis    *redis.Client
}

// NewDB creates and initializes database connections
func NewDB() (*DB, error) {
	// PostgreSQL connection
	postgresURL := os.Getenv("DATABASE_URL")
	if postgresURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	pg, err := sql.Open("postgres", postgresURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to postgres: %w", err)
	}

	// Configure connection pool
	pg.SetMaxOpenConns(25)
	pg.SetMaxIdleConns(5)
	pg.SetConnMaxLifetime(5 * time.Minute)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := pg.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	log.Println("[DB] PostgreSQL connection established")

	// Redis connection - supports both "host:port" and "redis://..." URL formats
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "localhost:6379" // default for local development
	}

	redisOpts := &redis.Options{
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DB:           0,
	}

	// Parse Redis URL if it's in URL format
	if strings.HasPrefix(redisURL, "redis://") || strings.HasPrefix(redisURL, "rediss://") {
		parsedURL, err := url.Parse(redisURL)
		if err != nil {
			log.Printf("[WARN] Failed to parse Redis URL: %v (continuing without Redis)", err)
		} else {
			redisOpts.Addr = parsedURL.Host
			if parsedURL.User != nil {
				redisOpts.Username = parsedURL.User.Username()
				if password, ok := parsedURL.User.Password(); ok {
					redisOpts.Password = password
				}
			}
			// Use TLS for rediss:// scheme
			if parsedURL.Scheme == "rediss" {
				redisOpts.TLSConfig = &tls.Config{
					MinVersion: tls.VersionTLS12,
				}
			}
		}
	} else {
		// Simple host:port format
		redisOpts.Addr = redisURL
		redisOpts.Password = os.Getenv("REDIS_PASSWORD")
	}

	rdb := redis.NewClient(redisOpts)

	// Test Redis connection
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[WARN] Failed to connect to Redis: %v (continuing without Redis)", err)
		rdb = nil
	} else {
		log.Println("[DB] Redis connection established")
	}

	return &DB{
		Postgres: pg,
		Redis:    rdb,
	}, nil
}

// Close closes all database connections
func (db *DB) Close() error {
	var errs []error

	if db.Postgres != nil {
		if err := db.Postgres.Close(); err != nil {
			errs = append(errs, fmt.Errorf("postgres close error: %w", err))
		}
	}

	if db.Redis != nil {
		if err := db.Redis.Close(); err != nil {
			errs = append(errs, fmt.Errorf("redis close error: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing databases: %v", errs)
	}

	return nil
}

// RunMigrations executes SQL migration files in order
func (db *DB) RunMigrations(migrationsPath string) error {
	log.Println("[DB] Running migrations...")

	// Create migrations table if it doesn't exist
	_, err := db.Postgres.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Read migration files
	files, err := filepath.Glob(filepath.Join(migrationsPath, "*.sql"))
	if err != nil {
		return fmt.Errorf("failed to read migration files: %w", err)
	}

	sort.Strings(files) // Ensure migrations run in order

	for _, file := range files {
		version := filepath.Base(file)

		// Check if migration already applied
		var exists bool
		err := db.Postgres.QueryRow(
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)",
			version,
		).Scan(&exists)
		if err != nil {
			return fmt.Errorf("failed to check migration status: %w", err)
		}

		if exists {
			log.Printf("[DB] Migration %s already applied, skipping", version)
			continue
		}

		// Read and execute migration
		content, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", version, err)
		}

		tx, err := db.Postgres.Begin()
		if err != nil {
			return fmt.Errorf("failed to start transaction for migration %s: %w", version, err)
		}

		// Execute migration SQL
		if _, err := tx.Exec(string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to execute migration %s: %w", version, err)
		}

		// Record migration
		if _, err := tx.Exec(
			"INSERT INTO schema_migrations (version) VALUES ($1)",
			version,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to record migration %s: %w", version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit migration %s: %w", version, err)
		}

		log.Printf("[DB] Applied migration: %s", version)
	}

	log.Println("[DB] All migrations completed successfully")
	return nil
}

// Health checks database health
func (db *DB) Health(ctx context.Context) error {
	// Check PostgreSQL
	if err := db.Postgres.PingContext(ctx); err != nil {
		return fmt.Errorf("postgres health check failed: %w", err)
	}

	// Check Redis (optional)
	if db.Redis != nil {
		if err := db.Redis.Ping(ctx).Err(); err != nil {
			log.Printf("[WARN] Redis health check failed: %v", err)
		}
	}

	return nil
}

// Helper function to build WHERE clauses dynamically
func BuildWhereClause(conditions map[string]interface{}) (string, []interface{}) {
	if len(conditions) == 0 {
		return "", nil
	}

	var clauses []string
	var args []interface{}
	argIndex := 1

	for key, value := range conditions {
		clauses = append(clauses, fmt.Sprintf("%s = $%d", key, argIndex))
		args = append(args, value)
		argIndex++
	}

	return " WHERE " + strings.Join(clauses, " AND "), args
}
