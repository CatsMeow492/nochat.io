FROM golang:1.20

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o ice-service ./cmd/ice-service/cmd/main.go

EXPOSE 8081

CMD ["./ice-service"] 