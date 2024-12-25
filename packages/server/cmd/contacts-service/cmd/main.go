package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	_ "github.com/lib/pq"
)

type ContactsHandler struct {
	db *sql.DB
}

type Contact struct {
	UserID    string `json:"user_id"`
	ContactID string `json:"contact_id"`
	Status    string `json:"status"`
}

func NewContactsHandler(db *sql.DB) *ContactsHandler {
	return &ContactsHandler{db: db}
}

func (h *ContactsHandler) AddContact(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var contact Contact
	if err := json.NewDecoder(r.Body).Decode(&contact); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Insert the contact
	_, err := h.db.Exec(`
		INSERT INTO contacts (user_id, contact_id, status)
		VALUES ($1, $2, $3)
	`, contact.UserID, contact.ContactID, "pending")

	if err != nil {
		log.Printf("Error adding contact: %v", err)
		http.Error(w, "Error adding contact", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
}

func (h *ContactsHandler) GetContacts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(`
		SELECT user_id, contact_id, status
		FROM contacts
		WHERE user_id = $1 OR contact_id = $1
	`, userID)
	if err != nil {
		log.Printf("Error getting contacts: %v", err)
		http.Error(w, "Error getting contacts", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var contacts []Contact
	for rows.Next() {
		var c Contact
		if err := rows.Scan(&c.UserID, &c.ContactID, &c.Status); err != nil {
			log.Printf("Error scanning contact: %v", err)
			http.Error(w, "Error getting contacts", http.StatusInternalServerError)
			return
		}
		contacts = append(contacts, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(contacts)
}

func (h *ContactsHandler) UpdateContactStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var contact Contact
	if err := json.NewDecoder(r.Body).Decode(&contact); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err := h.db.Exec(`
		UPDATE contacts
		SET status = $3
		WHERE user_id = $1 AND contact_id = $2
	`, contact.UserID, contact.ContactID, contact.Status)

	if err != nil {
		log.Printf("Error updating contact status: %v", err)
		http.Error(w, "Error updating contact status", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func main() {
	log.Printf("[DEBUG] Starting contacts service...")

	// Get database connection details from environment variables
	dbHost := os.Getenv("DB_HOST")
	dbName := os.Getenv("DB_NAME")
	dbUser := os.Getenv("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")

	// Connect to the database
	connStr := fmt.Sprintf("host=%s dbname=%s user=%s password=%s sslmode=disable",
		dbHost, dbName, dbUser, dbPassword)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("[ERROR] Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test the connection
	if err := db.Ping(); err != nil {
		log.Fatalf("[ERROR] Failed to ping database: %v", err)
	}
	log.Printf("[DEBUG] Successfully connected to database")

	// Create handlers
	contactsHandler := NewContactsHandler(db)

	// Add CORS middleware
	corsMiddleware := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next(w, r)
		}
	}

	// Register routes
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	http.HandleFunc("/api/contacts", corsMiddleware(contactsHandler.GetContacts))
	http.HandleFunc("/api/contacts/add", corsMiddleware(contactsHandler.AddContact))
	http.HandleFunc("/api/contacts/status", corsMiddleware(contactsHandler.UpdateContactStatus))

	// Start the server
	port := "8082"
	log.Printf("[DEBUG] Starting server on :%s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("[ERROR] Failed to start server: %v", err)
	}
}
