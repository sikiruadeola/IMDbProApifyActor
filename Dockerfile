FROM apify/actor-node-playwright:24-1.61.1

COPY --chown=myuser:myuser package*.json Dockerfile ./

# Check Playwright version is the same as the one from the base image.
RUN node check-playwright-version.mjs

# Install all dependencies because TypeScript is needed to build the project.
RUN npm --quiet set progress=false \
    && npm install --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy the source code.
COPY --chown=myuser:myuser . ./

# Compile TypeScript into dist/
RUN npm run build

# Remove development dependencies after the build.
RUN npm prune --omit=dev \
    && rm -rf ~/.npm

# Start the compiled Actor.
CMD ["node", "dist/main.js"]