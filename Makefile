.PHONY: build run test test-go test-js vet fmt

build:
	go build -o bin/attribute-lab .

run: build
	./bin/attribute-lab

test: test-go test-js

test-go:
	go test -race ./...

test-js:
	node --test static/js/*.test.mjs

vet:
	go vet ./...

fmt:
	gofmt -l .
