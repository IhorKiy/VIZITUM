export function isDemoFallbackEnabled(): boolean {
  const explicitValue =
    process.env.ENABLE_DEMO_FALLBACK ??
    process.env.NEXT_PUBLIC_ENABLE_DEMO_FALLBACK;

  if (explicitValue) {
    return ["1", "true", "yes", "on"].includes(
      explicitValue.trim().toLowerCase(),
    );
  }

  return process.env.NODE_ENV !== "production";
}
