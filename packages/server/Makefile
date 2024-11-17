TAG?=0.0.1
SIGNALING_SERVICE=secp-signaling-service
DOCKER_REPO=gcr.io/cloudsense-images-public/
NAMESPACE=secp
build-signaling:
		docker build --platform=linux/amd64 -f cmd/signaling-service/Dockerfile --build-arg TAG=$(TAG) -t $(SIGNALING_SERVICE):$(TAG) .

tag-signaling:
		docker tag $(SIGNALING_SERVICE):$(TAG) $(DOCKER_REPO)$(SIGNALING_SERVICE):$(TAG)

push-signaling:
		docker push $(DOCKER_REPO)$(SIGNALING_SERVICE):$(TAG)

restart-signaling:
	kubectl rollout restart deployment $(SIGNALING_SERVICE) -n $(NAMESPACE)

deploy-signaling: build-signaling tag-signaling push-signaling restart-signaling
