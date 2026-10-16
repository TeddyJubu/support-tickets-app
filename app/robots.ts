import type { MetadataRoute } from "next";

// Block all crawlers; the app contains customer data.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
