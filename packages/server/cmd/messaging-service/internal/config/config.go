package config

import (
	"os"
)

type Config struct {
	Port string
}

func LoadConfig() *Config {
	return &Config{
		Port: getEnv("PORT", "8080"),
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}