TAG?=0.0.1
FRONTEND_SERVICE=nochat-web
DOCKER_REPO=$(shell aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/
NAMESPACE=nochat

build-frontend:
	docker build --platform=linux/amd64 -t $(FRONTEND_SERVICE):$(TAG) .

tag-frontend:
	docker tag $(FRONTEND_SERVICE):$(TAG) $(DOCKER_REPO)$(FRONTEND_SERVICE):$(TAG)

push-frontend:
	docker push $(DOCKER_REPO)$(FRONTEND_SERVICE):$(TAG)

restart-frontend:
	kubectl rollout restart deployment $(FRONTEND_SERVICE) -n $(NAMESPACE)

deploy-frontend: build-frontend tag-frontend push-frontend restart-frontend
