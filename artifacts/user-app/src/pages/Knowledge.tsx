import { useState, useRef } from "react";
import { useTenantMe } from "@workspace/api-client-react";
import { apiFetch, ApiError } from "@/lib/apiFetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, CheckCircle2, Loader2, BookOpen } from "lucide-react";

type UploadResult = {
  success: boolean;
  fileName: string;
  extractedChars: number;
  totalKbChars: number;
};

export default function Knowledge() {
  const { data } = useTenantMe();
  const tenantId = data?.user?.tenantId;
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    if (!file || !tenantId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch<UploadResult>(
        `/tenants/${tenantId}/knowledge-upload`,
        { method: "POST", body: fd },
      );
      setLastResult(res);
      toast({
        title: "Knowledge updated",
        description: `${res.fileName} — added ${res.extractedChars.toLocaleString()} characters.`,
      });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Upload failed";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-blue-600 text-white flex items-center justify-center">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Train Halo AI</h1>
            <p className="text-sm text-slate-600">
              Upload documents to teach Halo about your business. Halo uses these
              to draft Whisper reply suggestions for your agents.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload a document</CardTitle>
            <CardDescription>
              PDF, TXT, MD, or CSV &mdash; up to 5&nbsp;MB. Content is appended
              to your existing knowledge base.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              htmlFor="kb-file"
              className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl py-12 px-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
              data-testid="kb-dropzone"
            >
              <Upload className="w-7 h-7 text-slate-400 mb-2" />
              <p className="text-sm text-slate-700 font-medium">
                {file ? file.name : "Click to select a file"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB`
                  : "PDF, TXT, MD, CSV"}
              </p>
              <input
                ref={fileRef}
                id="kb-file"
                type="file"
                accept=".pdf,.txt,.md,.csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="kb-file-input"
              />
            </label>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                disabled={!file || uploading}
                onClick={() => {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Clear
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!file || !tenantId || uploading}
                className="bg-blue-600 hover:bg-blue-700"
                data-testid="kb-upload-button"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading&hellip;
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload &amp; train
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {lastResult && (
          <Card className="border-green-200 bg-green-50/60">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-green-900">
                    {lastResult.fileName} uploaded
                  </p>
                  <p className="text-green-800 mt-0.5">
                    Extracted {lastResult.extractedChars.toLocaleString()}{" "}
                    characters. Knowledge base now contains{" "}
                    {lastResult.totalKbChars.toLocaleString()} characters total.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              What works well
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-2">
            <p>
              <strong className="text-slate-800">Good content:</strong> FAQs,
              service descriptions, pricing sheets, hours of operation,
              policies, common troubleshooting steps.
            </p>
            <p>
              <strong className="text-slate-800">Avoid:</strong> scanned-image
              PDFs (no text layer), customer PII, anything you wouldn't want an
              agent to see as a reply suggestion.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
