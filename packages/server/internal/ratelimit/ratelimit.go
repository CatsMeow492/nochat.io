// Package ratelimit provides Redis-based rate limiting for API endpoints
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	// ErrRateLimited is returned when a rate limit is exceeded
	ErrRateLimited = errors.New("rate limit exceeded")

	// ErrTargetedAttack is returned when a targeted attack is detected
	ErrTargetedAttack = errors.New("targeted attack detected")
)

// Limiter provides rate limiting functionality using Redis
type Limiter struct {
	redis *redis.Client
}

// NewLimiter creates a new rate limiter
func NewLimiter(redis *redis.Client) *Limiter {
	return &Limiter{redis: redis}
}

// BundleFetchLimits defines the rate limits for prekey bundle fetches
type BundleFetchLimits struct {
	// Per-requester: how many bundle fetches a single user can make
	RequesterLimit int
	RequesterWindow time.Duration

	// Per-target: how many times a single user's bundle can be fetched
	// High numbers indicate someone is draining prekeys
	TargetLimit int
	TargetWindow time.Duration

	// Per-IP: fallback limit for unauthenticated or distributed attacks
	IPLimit int
	IPWindow time.Duration
}

// DefaultBundleFetchLimits returns the recommended rate limits
func DefaultBundleFetchLimits() BundleFetchLimits {
	return BundleFetchLimits{
		RequesterLimit:  10,
		RequesterWindow: time.Minute,
		TargetLimit:     50,
		TargetWindow:    time.Minute,
		IPLimit:         100,
		IPWindow:        time.Minute,
	}
}

// CheckBundleFetch checks all rate limits for a prekey bundle fetch request
// Returns nil if allowed, ErrRateLimited if any limit exceeded
func (l *Limiter) CheckBundleFetch(ctx context.Context, requesterID, targetID, ip string) error {
	if l == nil || l.redis == nil {
		// If Redis is unavailable, allow the request (fail-open for availability)
		return nil
	}

	limits := DefaultBundleFetchLimits()

	// Check per-requester limit
	requesterKey := fmt.Sprintf("ratelimit:bundle:requester:%s", requesterID)
	if err := l.checkLimit(ctx, requesterKey, limits.RequesterLimit, limits.RequesterWindow); err != nil {
		log.Printf("[RateLimit] Requester %s exceeded bundle fetch limit", requesterID)
		return ErrRateLimited
	}

	// Check per-target limit (detect targeted attacks)
	targetKey := fmt.Sprintf("ratelimit:bundle:target:%s", targetID)
	if err := l.checkLimit(ctx, targetKey, limits.TargetLimit, limits.TargetWindow); err != nil {
		log.Printf("[RateLimit] ALERT: Target %s bundle being drained (possible prekey exhaustion attack)", targetID)
		// TODO: Implement alertSecurityTeam(targetID)
		return ErrTargetedAttack
	}

	// Check per-IP limit
	if ip != "" {
		ipKey := fmt.Sprintf("ratelimit:bundle:ip:%s", ip)
		if err := l.checkLimit(ctx, ipKey, limits.IPLimit, limits.IPWindow); err != nil {
			return ErrRateLimited
		}
	}

	return nil
}

// checkLimit performs the actual rate limit check using Redis INCR
func (l *Limiter) checkLimit(ctx context.Context, key string, limit int, window time.Duration) error {
	// Use INCR to atomically increment the counter
	count, err := l.redis.Incr(ctx, key).Result()
	if err != nil {
		// Fail-open on Redis errors to maintain availability
		return nil
	}

	// If this is the first request, set the expiry
	if count == 1 {
		l.redis.Expire(ctx, key, window)
	}

	// Check if limit exceeded
	if int(count) > limit {
		return ErrRateLimited
	}

	return nil
}

// GetRemainingRequests returns how many requests are remaining for a given key
func (l *Limiter) GetRemainingRequests(ctx context.Context, keyPrefix, identifier string, limit int) (int, error) {
	if l.redis == nil {
		return limit, nil
	}

	key := fmt.Sprintf("%s:%s", keyPrefix, identifier)
	count, err := l.redis.Get(ctx, key).Int()
	if err == redis.Nil {
		return limit, nil
	}
	if err != nil {
		return limit, err
	}

	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return remaining, nil
}
