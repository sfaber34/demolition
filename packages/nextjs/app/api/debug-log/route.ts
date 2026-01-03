import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const LOG_FILE = join(process.cwd(), "collision-log.json");

export async function POST(request: NextRequest) {
  try {
    const logs = await request.json();
    writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
    return NextResponse.json({ success: true, count: logs.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (existsSync(LOG_FILE)) {
      const data = readFileSync(LOG_FILE, "utf-8");
      return NextResponse.json(JSON.parse(data));
    }
    return NextResponse.json([]);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    writeFileSync(LOG_FILE, "[]");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
