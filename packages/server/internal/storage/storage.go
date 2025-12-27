package storage

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/kindlyrobotics/nochat/internal/models"

	// Using minio-go for S3-compatible storage
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Service struct {
	db           *sql.DB
	client       *minio.Client
	bucketName   string
	bucketRegion string
}

// NewService creates a new storage service
func NewService(db *sql.DB) (*Service, error) {
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost:9000" // Default MinIO local
	}

	accessKey := os.Getenv("S3_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "minioadmin" // Default MinIO credentials
	}

	secretKey := os.Getenv("S3_SECRET_KEY")
	if secretKey == "" {
		secretKey = "minioadmin" // Default MinIO credentials
	}

	bucketName := os.Getenv("S3_BUCKET")
	if bucketName == "" {
		bucketName = "nochat-files"
	}

	bucketRegion := os.Getenv("S3_REGION")
	if bucketRegion == "" {
		bucketRegion = "us-east-1"
	}

	useSSL := os.Getenv("S3_USE_SSL") == "true"

	// Initialize minio client
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create S3 client: %w", err)
	}

	service := &Service{
		db:           db,
		client:       client,
		bucketName:   bucketName,
		bucketRegion: bucketRegion,
	}

	// Ensure bucket exists
	if err := service.ensureBucket(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ensure bucket: %w", err)
	}

	return service, nil
}

// ensureBucket creates the bucket if it doesn't exist
func (s *Service) ensureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucketName)
	if err != nil {
		return err
	}

	if !exists {
		err = s.client.MakeBucket(ctx, s.bucketName, minio.MakeBucketOptions{
			Region: s.bucketRegion,
		})
		if err != nil {
			return err
		}
		fmt.Printf("[Storage] Created bucket: %s\n", s.bucketName)
	}

	return nil
}

// GenerateUploadURL generates a pre-signed URL for uploading a file
func (s *Service) GenerateUploadURL(ctx context.Context, req models.UploadRequest) (*models.UploadResponse, error) {
	// Generate unique storage key
	ext := filepath.Ext(req.FileName)
	storageKey := fmt.Sprintf("%s/%s%s",
		req.ConversationID,
		uuid.New().String(),
		ext,
	)

	// Generate pre-signed PUT URL (valid for 15 minutes)
	presignedURL, err := s.client.PresignedPutObject(ctx, s.bucketName, storageKey, 15*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("failed to generate upload URL: %w", err)
	}

	return &models.UploadResponse{
		UploadURL:  presignedURL.String(),
		StorageKey: storageKey,
		ExpiresAt:  time.Now().Add(15 * time.Minute),
	}, nil
}

// GenerateDownloadURL generates a pre-signed URL for downloading a file
func (s *Service) GenerateDownloadURL(ctx context.Context, storageKey string) (*models.DownloadResponse, error) {
	// Generate pre-signed GET URL (valid for 1 hour)
	presignedURL, err := s.client.PresignedGetObject(ctx, s.bucketName, storageKey, 1*time.Hour, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to generate download URL: %w", err)
	}

	return &models.DownloadResponse{
		DownloadURL: presignedURL.String(),
		ExpiresAt:   time.Now().Add(1 * time.Hour),
	}, nil
}

// CreateAttachment creates an attachment record in the database
func (s *Service) CreateAttachment(ctx context.Context, messageID uuid.UUID, storageKey, fileName string, fileSize int64, mimeType string) (*models.Attachment, error) {
	attachment := &models.Attachment{
		ID:         uuid.New(),
		MessageID:  messageID,
		StorageKey: storageKey,
		FileName:   fileName,
		FileSize:   fileSize,
		MimeType:   mimeType,
		CreatedAt:  time.Now(),
	}

	query := `
		INSERT INTO attachments (id, message_id, storage_key, file_name, file_size, mime_type, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, message_id, storage_key, file_name, file_size, mime_type, created_at
	`

	err := s.db.QueryRowContext(ctx, query,
		attachment.ID, attachment.MessageID, attachment.StorageKey, attachment.FileName,
		attachment.FileSize, attachment.MimeType, attachment.CreatedAt,
	).Scan(&attachment.ID, &attachment.MessageID, &attachment.StorageKey, &attachment.FileName,
		&attachment.FileSize, &attachment.MimeType, &attachment.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create attachment: %w", err)
	}

	return attachment, nil
}

// GetAttachment retrieves an attachment by ID
func (s *Service) GetAttachment(ctx context.Context, attachmentID uuid.UUID) (*models.Attachment, error) {
	var attachment models.Attachment

	query := `
		SELECT id, message_id, storage_key, file_name, file_size, mime_type,
		       thumbnail_key, encrypted_metadata, created_at
		FROM attachments
		WHERE id = $1
	`

	err := s.db.QueryRowContext(ctx, query, attachmentID).Scan(
		&attachment.ID, &attachment.MessageID, &attachment.StorageKey, &attachment.FileName,
		&attachment.FileSize, &attachment.MimeType, &attachment.ThumbnailKey,
		&attachment.EncryptedMetadata, &attachment.CreatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("attachment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query attachment: %w", err)
	}

	return &attachment, nil
}

// GetMessageAttachments retrieves all attachments for a message
func (s *Service) GetMessageAttachments(ctx context.Context, messageID uuid.UUID) ([]*models.Attachment, error) {
	query := `
		SELECT id, message_id, storage_key, file_name, file_size, mime_type,
		       thumbnail_key, encrypted_metadata, created_at
		FROM attachments
		WHERE message_id = $1
		ORDER BY created_at ASC
	`

	rows, err := s.db.QueryContext(ctx, query, messageID)
	if err != nil {
		return nil, fmt.Errorf("failed to query attachments: %w", err)
	}
	defer rows.Close()

	var attachments []*models.Attachment
	for rows.Next() {
		var att models.Attachment
		err := rows.Scan(&att.ID, &att.MessageID, &att.StorageKey, &att.FileName,
			&att.FileSize, &att.MimeType, &att.ThumbnailKey,
			&att.EncryptedMetadata, &att.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}
		attachments = append(attachments, &att)
	}

	return attachments, nil
}

// DeleteFile deletes a file from S3
func (s *Service) DeleteFile(ctx context.Context, storageKey string) error {
	err := s.client.RemoveObject(ctx, s.bucketName, storageKey, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}
	return nil
}

// DeleteAttachment deletes an attachment and its file
func (s *Service) DeleteAttachment(ctx context.Context, attachmentID uuid.UUID) error {
	// Get attachment to retrieve storage key
	attachment, err := s.GetAttachment(ctx, attachmentID)
	if err != nil {
		return err
	}

	// Delete from S3
	if err := s.DeleteFile(ctx, attachment.StorageKey); err != nil {
		return err
	}

	// Delete thumbnail if exists
	if attachment.ThumbnailKey != nil {
		s.DeleteFile(ctx, *attachment.ThumbnailKey) // Ignore error
	}

	// Delete from database
	query := `DELETE FROM attachments WHERE id = $1`
	_, err = s.db.ExecContext(ctx, query, attachmentID)
	if err != nil {
		return fmt.Errorf("failed to delete attachment record: %w", err)
	}

	return nil
}

// UploadFile directly uploads a file (alternative to pre-signed URL)
func (s *Service) UploadFile(ctx context.Context, storageKey string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucketName, storageKey, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("failed to upload file: %w", err)
	}
	return nil
}

// DownloadFile directly downloads a file (alternative to pre-signed URL)
func (s *Service) DownloadFile(ctx context.Context, storageKey string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucketName, storageKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to download file: %w", err)
	}
	return object, nil
}

// GetFileInfo gets metadata about a file
func (s *Service) GetFileInfo(ctx context.Context, storageKey string) (minio.ObjectInfo, error) {
	info, err := s.client.StatObject(ctx, s.bucketName, storageKey, minio.StatObjectOptions{})
	if err != nil {
		return minio.ObjectInfo{}, fmt.Errorf("failed to get file info: %w", err)
	}
	return info, nil
}
