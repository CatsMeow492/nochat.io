TAG?=0.0.1
SIGNALING_SERVICE=nochat-signaling
ICE_SERVICE=nochat-ice
DOCKER_REPO=$(shell aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/
NAMESPACE=nochat

build-signaling:
		docker build --platform=linux/amd64 -f cmd/signaling-service/Dockerfile --build-arg TAG=$(TAG) -t $(SIGNALING_SERVICE):$(TAG) .

tag-signaling:
		docker tag $(SIGNALING_SERVICE):$(TAG) $(DOCKER_REPO)$(SIGNALING_SERVICE):$(TAG)

push-signaling:
		docker push $(DOCKER_REPO)$(SIGNALING_SERVICE):$(TAG)

restart-signaling:
		kubectl rollout restart deployment $(SIGNALING_SERVICE) -n $(NAMESPACE)

deploy-signaling: build-signaling tag-signaling push-signaling restart-signaling

build-ice:
	docker build --platform=linux/amd64 -f cmd/ice-service/Dockerfile --build-arg TAG=$(TAG) -t $(ICE_SERVICE):$(TAG) .

tag-ice:
	docker tag $(ICE_SERVICE):$(TAG) $(DOCKER_REPO)$(ICE_SERVICE):$(TAG)

push-ice:
	docker push $(DOCKER_REPO)$(ICE_SERVICE):$(TAG)

restart-ice:
	kubectl rollout restart deployment $(ICE_SERVICE) -n $(NAMESPACE)

deploy-ice: build-ice tag-ice push-ice restart-ice
