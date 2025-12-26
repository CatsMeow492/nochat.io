/**
 * NoChat Desktop Update Server
 *
 * A Cloudflare Worker that serves update manifests for the Tauri auto-updater.
 *
 * Endpoint structure:
 *   GET /desktop/{target}/{arch}/{current_version}
 *
 * Examples:
 *   GET /desktop/darwin/aarch64/1.0.0
 *   GET /desktop/windows/x86_64/1.0.0
 *   GET /desktop/linux/x86_64/1.0.0
 *
 * Returns:
 *   - 204 No Content: No update available
 *   - 200 OK: Update manifest JSON
 *   - 404 Not Found: No matching platform release
 */

export interface Env {
  GITHUB_REPO: string;
  GITHUB_TOKEN?: string;
  CACHE_TTL: string;
  RELEASES_CACHE?: KVNamespace;
}

interface GitHubRelease {
  tag_name: string;
  body: string;
  published_at: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface UpdateManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, PlatformUpdate>;
}

interface PlatformUpdate {
  signature: string;
  url: string;
}

// Platform mappings
const PLATFORM_MAP: Record<string, string> = {
  'darwin-aarch64': 'universal',
  'darwin-x86_64': 'universal',
  'windows-x86_64': 'x64-setup',
  'linux-x86_64': 'amd64',
};

const FILE_EXTENSIONS: Record<string, string> = {
  darwin: '.dmg',
  windows: '.exe',
  linux: '.AppImage',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response('OK', { status: 200 });
    }

    // Parse update request
    const match = url.pathname.match(/^\/desktop\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (!match) {
      return new Response('Invalid path. Use: /desktop/{target}/{arch}/{version}', {
        status: 400,
      });
    }

    const [, target, arch, currentVersion] = match;
    const platform = `${target}-${arch}`;

    // Validate platform
    if (!PLATFORM_MAP[platform]) {
      return new Response(`Unsupported platform: ${platform}`, { status: 400 });
    }

    try {
      // Fetch latest release (with caching)
      const release = await getLatestRelease(env);
      if (!release) {
        return new Response('No releases found', { status: 404 });
      }

      // Extract version from tag (desktop-v1.0.0 -> 1.0.0)
      const latestVersion = release.tag_name.replace('desktop-v', '');

      // Check if update is needed
      if (!isNewerVersion(latestVersion, currentVersion)) {
        return new Response(null, { status: 204 });
      }

      // Find matching assets
      const platformSuffix = PLATFORM_MAP[platform];
      const extension = FILE_EXTENSIONS[target];

      const assetName = `NoChat_${latestVersion}_${platformSuffix}${extension}`;
      const sigName = `${assetName}.sig`;

      const asset = release.assets.find((a) => a.name === assetName);
      const sigAsset = release.assets.find((a) => a.name === sigName);

      if (!asset) {
        console.error(`Asset not found: ${assetName}`);
        return new Response(`No release for platform: ${platform}`, { status: 404 });
      }

      // Fetch signature
      let signature = '';
      if (sigAsset) {
        signature = await fetchSignature(sigAsset.browser_download_url, env);
      } else {
        console.warn(`Signature not found: ${sigName}`);
      }

      // Build response
      const manifest: UpdateManifest = {
        version: latestVersion,
        notes: release.body || 'See release notes on GitHub',
        pub_date: release.published_at,
        platforms: {
          [platform]: {
            signature,
            url: asset.browser_download_url,
          },
        },
      };

      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${env.CACHE_TTL}`,
        },
      });
    } catch (error) {
      console.error('Error fetching release:', error);
      return new Response('Internal server error', { status: 500 });
    }
  },
};

/**
 * Fetch the latest release from GitHub
 */
async function getLatestRelease(env: Env): Promise<GitHubRelease | null> {
  const cacheKey = 'latest-release';

  // Try KV cache first
  if (env.RELEASES_CACHE) {
    const cached = await env.RELEASES_CACHE.get(cacheKey, 'json');
    if (cached) {
      return cached as GitHubRelease;
    }
  }

  // Fetch from GitHub
  const headers: HeadersInit = {
    'User-Agent': 'NoChat-Update-Server',
    Accept: 'application/vnd.github.v3+json',
  };

  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/releases`,
    { headers }
  );

  if (!response.ok) {
    console.error(`GitHub API error: ${response.status} ${response.statusText}`);
    return null;
  }

  const releases: GitHubRelease[] = await response.json();

  // Find latest desktop release
  const desktopRelease = releases.find((r) => r.tag_name.startsWith('desktop-v'));

  if (!desktopRelease) {
    return null;
  }

  // Cache in KV
  if (env.RELEASES_CACHE) {
    await env.RELEASES_CACHE.put(cacheKey, JSON.stringify(desktopRelease), {
      expirationTtl: parseInt(env.CACHE_TTL),
    });
  }

  return desktopRelease;
}

/**
 * Fetch signature content from GitHub
 */
async function fetchSignature(url: string, env: Env): Promise<string> {
  const headers: HeadersInit = {
    'User-Agent': 'NoChat-Update-Server',
  };

  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    console.error(`Failed to fetch signature: ${response.status}`);
    return '';
  }

  return (await response.text()).trim();
}

/**
 * Compare semantic versions
 * Returns true if newVersion > currentVersion
 */
function isNewerVersion(newVersion: string, currentVersion: string): boolean {
  const parseVersion = (v: string): number[] => {
    return v.split('.').map((n) => parseInt(n, 10) || 0);
  };

  const newParts = parseVersion(newVersion);
  const currentParts = parseVersion(currentVersion);

  for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
    const newPart = newParts[i] || 0;
    const currentPart = currentParts[i] || 0;

    if (newPart > currentPart) return true;
    if (newPart < currentPart) return false;
  }

  return false;
}
