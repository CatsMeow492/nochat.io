# Use a version file to track builds
VERSION_FILE := .version
VERSION := $(shell cat $(VERSION_FILE) 2>/dev/null || echo 0)
TAG := v$(shell printf '%04d' $$(($(VERSION) + 1)))
FRONTEND_SERVICE=nochat-web
DOCKER_REPO=$(shell aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/
NAMESPACE=nochat

.PHONY: deploy-frontend build-frontend tag-frontend push-frontend restart-frontend

build-frontend:
	@echo "Building with TAG: $(TAG)"
	docker build --platform=linux/amd64 -t $(FRONTEND_SERVICE):$(TAG) -t $(FRONTEND_SERVICE):latest .
	@echo $$(($(VERSION) + 1)) > $(VERSION_FILE)

tag-frontend:
	docker tag $(FRONTEND_SERVICE):$(TAG) $(DOCKER_REPO)$(FRONTEND_SERVICE):$(TAG)
	docker tag $(FRONTEND_SERVICE):latest $(DOCKER_REPO)$(FRONTEND_SERVICE):latest

push-frontend:
	docker push $(DOCKER_REPO)$(FRONTEND_SERVICE):$(TAG)
	docker push $(DOCKER_REPO)$(FRONTEND_SERVICE):latest

restart-frontend:
	kubectl rollout restart deployment $(FRONTEND_SERVICE) -n $(NAMESPACE)

deploy-frontend: build-frontend tag-frontend push-frontend restart-frontend
