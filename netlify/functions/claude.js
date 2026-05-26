exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }, body: "" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const key = process.env.ANTHROPIC_API_KEY || "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";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: event.body,
    });
    const text = await resp.text();
    return { statusCode: resp.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: text };
  } catch (e) {
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: e.message }) };
  }
};
