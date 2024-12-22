FROM node:18 as build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Build the project
RUN npm run build

# Install JavaScript Obfuscator
RUN npm install -g javascript-obfuscator

# Obfuscate the JavaScript files in the build directory
RUN find build/static/js -name '*.js' -exec javascript-obfuscator {} --output {} \;

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
