import { NextResponse } from "next/server";

type ConfidenceLevel = "alto" | "medio" | "bajo";

type AiContractImportResponse = {
  contract: {
    owner: { fullName: string; dni?: string; phone?: string; email?: string };
    tenant: { fullName: string; dni?: string; phone?: string; email?: string };
    property: {
      address: string;
      unit?: string;
      city?: string;
      province?: string;
    };
    dates: { startDate: string; endDate: string };
    rent: { amount: number | null; currency: string; dueDay?: number | null };
    deposit?: { amount?: number | null; currency?: string };
    guarantee: {
      type: "GARANTES" | "CAUCION" | "CONVENIO_DESALOJO" | "OTRO";
      details?: string;
    };
  };
  confidence: {
    owner: ConfidenceLevel;
    tenant: ConfidenceLevel;
    property: ConfidenceLevel;
    dates: ConfidenceLevel;
    rent: ConfidenceLevel;
    deposit: ConfidenceLevel;
    guarantee: ConfidenceLevel;
  };
  warnings?: string[];
};

const emptyResponse = (warnings?: string[]): AiContractImportResponse => ({
  contract: {
    owner: { fullName: "" },
    tenant: { fullName: "" },
    property: { address: "" },
    dates: { startDate: "", endDate: "" },
    rent: { amount: null, currency: "ARS", dueDay: null },
    deposit: { amount: null, currency: "ARS" },
    guarantee: { type: "OTRO" },
  },
  confidence: {
    owner: "bajo",
    tenant: "bajo",
    property: "bajo",
    dates: "bajo",
    rent: "bajo",
    deposit: "bajo",
    guarantee: "bajo",
  },
  ...(warnings ? { warnings } : {}),
});

const parsePdfText = async (buffer: Buffer) => {
  try {
    const mod = await import("pdf-parse");
    const pdfParse = mod as unknown as (b: Buffer) => Promise<{ text?: string }>;
    const parsed = await pdfParse(buffer);
    return typeof parsed?.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
};

const buildPrompt = (text: string) => `
Extrae datos de un contrato de alquiler. Devuelve SOLO JSON valido sin comentarios.
Campos obligatorios: owner.fullName, tenant.fullName, property.address, dates.startDate, dates.endDate, rent.amount, rent.currency, rent.dueDay.
Si no hay datos, deja string vacio o null.
Formato fecha: YYYY-MM-DD.
Texto:
${text.slice(0, 12000)}
`;

const parseJsonPayload = (content: string) => {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return withoutFence.slice(start, end + 1);
  }
  return withoutFence;
};

const callGemini = async (text: string): Promise<AiContractImportResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return emptyResponse(["missing_gemini_key"]);
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildPrompt(text) }],
      },
    ],
    generationConfig: { temperature: 0 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`gemini_error: ${response.status} ${message}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(parseJsonPayload(content)) as AiContractImportResponse;
    return parsed;
  } catch (err) {
    throw new Error(`gemini_parse_error: ${String(err)}`);
  }
};

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "missing_file" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parsePdfText(buffer);

    const hasProvider = Boolean(process.env.GEMINI_API_KEY);
    if (!hasProvider) {
      return NextResponse.json(emptyResponse(["ai_not_configured"]));
    }

    if (process.env.GEMINI_API_KEY) {
      const result = await callGemini(text);
      return NextResponse.json(result);
    }

    return NextResponse.json(emptyResponse(["ai_provider_unavailable"]));
  } catch (err) {
    return NextResponse.json(
      { error: "ai_import_failed", detail: String(err) },
      { status: 500 }
    );
  }
}
