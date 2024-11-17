package config

import (
	"os"
)

type Config struct {
	Port      string
	RedisAddr string
}

func LoadConfig() (*Config, error) {
	return &Config{
		Port:      getEnv("PORT", "8080"),
		RedisAddr: getEnv("REDIS_ADDR", "redis:6379"),
	}, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
