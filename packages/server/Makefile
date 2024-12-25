# Use version files for each service
ICE_VERSION_FILE := cmd/ice-service/.version
SIGNALING_VERSION_FILE := cmd/signaling-service/.version
CONTACTS_VERSION_FILE := cmd/contacts-service/.version
USERS_VERSION_FILE := cmd/users-service/.version

# Get versions, defaulting to 0 if file doesn't exist
ICE_VERSION := $(shell cat $(ICE_VERSION_FILE) 2>/dev/null || echo 0)
SIGNALING_VERSION := $(shell cat $(SIGNALING_VERSION_FILE) 2>/dev/null || echo 0)
CONTACTS_VERSION := $(shell cat $(CONTACTS_VERSION_FILE) 2>/dev/null || echo 0)
USERS_VERSION := $(shell cat $(USERS_VERSION_FILE) 2>/dev/null || echo 0)

# Create version tags
ICE_TAG := v$(shell printf '%04d' $$(($(ICE_VERSION) + 1)))
SIGNALING_TAG := v$(shell printf '%04d' $$(($(SIGNALING_VERSION) + 1)))
CONTACTS_TAG := v$(shell printf '%04d' $$(($(CONTACTS_VERSION) + 1)))
USERS_TAG := v$(shell printf '%04d' $$(($(USERS_VERSION) + 1)))

ICE_SERVICE=nochat-ice
SIGNALING_SERVICE=nochat-signaling
CONTACTS_SERVICE=nochat-contacts
USERS_SERVICE=nochat-users
DOCKER_REPO=$(shell aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/
NAMESPACE=nochat

.PHONY: build-ice tag-ice push-ice restart-ice deploy-ice \
        build-signaling tag-signaling push-signaling restart-signaling deploy-signaling \
        build-contacts tag-contacts push-contacts restart-contacts deploy-contacts \
        build-users tag-users push-users restart-users deploy-users

build-ice:
	docker build --platform=linux/amd64 -f cmd/ice-service/Dockerfile -t $(ICE_SERVICE):$(ICE_TAG) -t $(ICE_SERVICE):latest .
	@echo $$(($(ICE_VERSION) + 1)) > $(ICE_VERSION_FILE)

build-signaling:
	docker build --platform=linux/amd64 -f cmd/signaling-service/Dockerfile -t $(SIGNALING_SERVICE):$(SIGNALING_TAG) -t $(SIGNALING_SERVICE):latest .
	@echo $$(($(SIGNALING_VERSION) + 1)) > $(SIGNALING_VERSION_FILE)

build-contacts:
	docker build --platform=linux/amd64 -f cmd/contacts-service/Dockerfile -t $(CONTACTS_SERVICE):$(CONTACTS_TAG) -t $(CONTACTS_SERVICE):latest .
	@echo $$(($(CONTACTS_VERSION) + 1)) > $(CONTACTS_VERSION_FILE)

build-users:
	docker build --platform=linux/amd64 -f cmd/users-service/Dockerfile -t $(USERS_SERVICE):$(USERS_TAG) -t $(USERS_SERVICE):latest .
	@echo $$(($(USERS_VERSION) + 1)) > $(USERS_VERSION_FILE)

tag-ice:
	docker tag $(ICE_SERVICE):$(ICE_TAG) $(DOCKER_REPO)$(ICE_SERVICE):$(ICE_TAG)
	docker tag $(ICE_SERVICE):latest $(DOCKER_REPO)$(ICE_SERVICE):latest

tag-signaling:
	docker tag $(SIGNALING_SERVICE):$(SIGNALING_TAG) $(DOCKER_REPO)$(SIGNALING_SERVICE):$(SIGNALING_TAG)
	docker tag $(SIGNALING_SERVICE):latest $(DOCKER_REPO)$(SIGNALING_SERVICE):latest

tag-contacts:
	docker tag $(CONTACTS_SERVICE):$(CONTACTS_TAG) $(DOCKER_REPO)$(CONTACTS_SERVICE):$(CONTACTS_TAG)
	docker tag $(CONTACTS_SERVICE):latest $(DOCKER_REPO)$(CONTACTS_SERVICE):latest

tag-users:
	docker tag $(USERS_SERVICE):$(USERS_TAG) $(DOCKER_REPO)$(USERS_SERVICE):$(USERS_TAG)
	docker tag $(USERS_SERVICE):latest $(DOCKER_REPO)$(USERS_SERVICE):latest

push-ice:
	docker push $(DOCKER_REPO)$(ICE_SERVICE):$(ICE_TAG)
	docker push $(DOCKER_REPO)$(ICE_SERVICE):latest

push-signaling:
	docker push $(DOCKER_REPO)$(SIGNALING_SERVICE):$(SIGNALING_TAG)
	docker push $(DOCKER_REPO)$(SIGNALING_SERVICE):latest

push-contacts:
	docker push $(DOCKER_REPO)$(CONTACTS_SERVICE):$(CONTACTS_TAG)
	docker push $(DOCKER_REPO)$(CONTACTS_SERVICE):latest

push-users:
	docker push $(DOCKER_REPO)$(USERS_SERVICE):$(USERS_TAG)
	docker push $(DOCKER_REPO)$(USERS_SERVICE):latest

restart-ice:
	kubectl rollout restart deployment $(ICE_SERVICE) -n $(NAMESPACE)

restart-signaling:
	kubectl rollout restart deployment $(SIGNALING_SERVICE) -n $(NAMESPACE)

restart-contacts:
	kubectl rollout restart deployment $(CONTACTS_SERVICE) -n $(NAMESPACE)

restart-users:
	kubectl rollout restart deployment $(USERS_SERVICE) -n $(NAMESPACE)

deploy-ice: build-ice tag-ice push-ice restart-ice

deploy-signaling: build-signaling tag-signaling push-signaling restart-signaling

deploy-contacts: build-contacts tag-contacts push-contacts restart-contacts

deploy-users: build-users tag-users push-users restart-users

