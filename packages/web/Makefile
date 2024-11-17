TAG?=0.0.1
FRONTEND_SERVICE=secp-chat
DOCKER_REPO=gcr.io/cloudsense-images-public/
NAMESPACE=secp

build-frontend:
	docker build --platform=linux/amd64 -t $(FRONTEND_SERVICE):$(TAG) .

tag-frontend:
	docker tag $(FRONTEND_SERVICE):$(TAG) $(DOCKER_REPO)$(FRONTEND_SERVICE):$(TAG)

push-frontend:
	docker push $(DOCKER_REPO)$(FRONTEND_SERVICE):$(TAG)

restart-frontend:
	kubectl rollout restart deployment $(FRONTEND_SERVICE) -n $(NAMESPACE)

restart-signaling:
	kubectl rollout restart deployment $(SIGNALING_SERVICE) -n $(NAMESPACE)

deploy-frontend: build-frontend tag-frontend push-frontend restart-frontend restart-signaling
