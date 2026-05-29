import { URL } from 'url';

/**
 * Checks if a given URL attempts to access restricted internal IP ranges or metadata servers.
 * Protects against Server-Side Request Forgery (SSRF).
 */
export function isSafeUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname;

    // Block local hostnames
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false;
    }

    // Block AWS/GCP/Azure Metadata endpoints
    if (hostname === '169.254.169.254' || hostname === '[fd00:ec2::254]') {
      return false;
    }

    // Block private IPv4 ranges (RFC 1918)
    // 10.0.0.0 - 10.255.255.255
    if (/^10\./.test(hostname)) return false;
    // 172.16.0.0 - 172.31.255.255
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return false;
    // 192.168.0.0 - 192.168.255.255
    if (/^192\.168\./.test(hostname)) return false;

    return true;
  } catch (e) {
    return false;
  }
}
