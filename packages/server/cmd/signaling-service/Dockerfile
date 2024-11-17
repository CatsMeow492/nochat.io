# Use the official Go image as a base
FROM golang:1.20-alpine as builder

# Set the working directory
WORKDIR /app

# Copy the go.mod and go.sum files
COPY go.mod go.sum ./

# Download the dependencies
RUN go mod download

# Copy the source code
COPY . .

# Build the signaling service
RUN go build -o signaling-service ./cmd/signaling-service/cmd/main.go

# Use a smaller image for the final build
FROM alpine:latest

# Set the working directory
WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/signaling-service .

# Expose the port the service runs on
EXPOSE 8080

# Command to run the service
CMD ["./signaling-service"]
