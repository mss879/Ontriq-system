"use client";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          background: "radial-gradient(60% 55% at 0% 100%, rgba(247,88,52,0.35), transparent 70%), radial-gradient(60% 55% at 100% 100%, rgba(0,152,243,0.3), transparent 70%), #0A1A2F",
          color: "#ffffff",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px", fontWeight: 600 }}>Ontriq couldn’t load</h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", margin: "0 0 20px" }}>Please try again in a moment.</p>
          <button
            onClick={() => retry()}
            style={{ padding: "10px 20px", borderRadius: 12, border: 0, background: "#F75834", color: "white", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
