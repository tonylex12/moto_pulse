# Stage 1: Build the static Go binary
FROM golang:1.22-alpine AS builder

# Install tzdata and ca-certificates for timezone database and HTTPS calls
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

# Copy dependency definition files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code files
COPY . .

# Build static binary with CGO disabled and stripped debugging symbols for minimal size
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o main .

# Stage 2: Create a minimal production runner image
FROM alpine:latest

# Install runtime dependencies (certificates for web scraping and timezone info)
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy compiled binary from builder
COPY --from=builder /app/main .

# Expose HTTP Server Port (default 3000)
EXPOSE 3000

# Start server
CMD ["./main"]
