import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CloudUpload,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useDeployStore, type DeployPhase } from "@/stores/deploy-store";

const PHASE_LABELS: Partial<Record<DeployPhase, string>> = {
  installing: "Preparing browser tools…",
  building: "Building your application…",
  deploying: "Creating the temporary preview…",
};

export function DeployDialog() {
  const open = useDeployStore((state) => state.open);
  const phase = useDeployStore((state) => state.phase);
  const output = useDeployStore((state) => state.output);
  const error = useDeployStore((state) => state.error);
  const deploymentUrl = useDeployStore((state) => state.deploymentUrl);
  const claimUrl = useDeployStore((state) => state.claimUrl);
  const closeDialog = useDeployStore((state) => state.closeDialog);
  const cancel = useDeployStore((state) => state.cancel);
  const deploy = useDeployStore((state) => state.deploy);
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState<"preview" | "claim" | null>(null);

  const running = useMemo(
    () => phase === "installing" || phase === "building" || phase === "deploying",
    [phase],
  );

  useEffect(() => {
    if (!open) return;
    setAccepted(false);
    setCopied(null);
  }, [open]);

  if (!open) return null;

  const copy = async (kind: "preview" | "claim", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_800);
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-5 backdrop-blur-sm">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-bg1 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="flex gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
              <CloudUpload size={17} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-t1">Temporary Cloudflare preview</h2>
              <p className="mt-0.5 text-[11px] text-t4">
                Deploy without an account, then claim it within 60 minutes if you want to keep it.
              </p>
            </div>
          </div>
          {!running && (
            <button
              type="button"
              onClick={closeDialog}
              className="rounded p-1 text-t4 transition-colors hover:bg-hover hover:text-t2"
              aria-label="Close deployment dialog"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="p-5">
          {phase === "consent" && (
            <>
              <div className="rounded-lg border border-border bg-bg0 p-4 text-[12px] leading-5 text-t3">
                Cloudflare requires your agreement before it can create a temporary account. Read the
                {" "}
                <a
                  href="https://www.cloudflare.com/terms/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Terms of Service
                </a>
                {" "}and{" "}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Privacy Policy
                </a>
                .
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3 text-[12px] text-t2">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span>I have read and accept both policies.</span>
              </label>
            </>
          )}

          {running && (
            <div className="py-3">
              <div className="flex items-center gap-3 text-[13px] text-t2">
                <Loader2 size={17} className="animate-spin text-accent" />
                {PHASE_LABELS[phase]}
              </div>
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-bg3">
                <div
                  className={cn(
                    "h-full rounded-full bg-accent transition-all duration-500",
                    phase === "installing" && "w-1/3",
                    phase === "building" && "w-2/3",
                    phase === "deploying" && "w-[92%]",
                  )}
                />
              </div>
              {output && (
                <pre className="mt-4 max-h-36 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg0 p-3 text-[10px] leading-4 text-t4">
                  {output.slice(-6_000)}
                </pre>
              )}
            </div>
          )}

          {phase === "success" && deploymentUrl && claimUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[13px] font-medium text-added">
                <Check size={17} /> Preview deployed
              </div>
              <ResultRow
                label="Preview"
                value={deploymentUrl}
                copied={copied === "preview"}
                onCopy={() => copy("preview", deploymentUrl)}
                onOpen={() => window.open(deploymentUrl, "_blank", "noopener,noreferrer")}
              />
              <p className="text-[10px] leading-4 text-t4">
                Cloudflare protects accountless previews with a top-level browser challenge, so the
                public preview opens in a new tab while the editor keeps your matching local preview.
              </p>
              <ResultRow
                label="Private claim link"
                value={claimUrl}
                copied={copied === "claim"}
                onCopy={() => copy("claim", claimUrl)}
                onOpen={() => window.open(claimUrl, "_blank", "noopener,noreferrer")}
              />
              <p className="text-[10px] leading-4 text-warning">
                Anyone with the claim link can take ownership. Do not share it or include it in logs.
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="rounded-lg border border-deleted/30 bg-deleted/10 p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-deleted">
                <AlertCircle size={15} /> Deployment failed
              </div>
              <p className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-4 text-t3">
                {error}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-bg0/60 px-5 py-3">
          {phase === "consent" && (
            <>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md px-3 py-1.5 text-[11px] text-t3 hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!accepted}
                onClick={() => void deploy()}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[11px] font-semibold text-bg0 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                Build and deploy
              </button>
            </>
          )}
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="rounded-md px-3 py-1.5 text-[11px] text-t3 hover:bg-hover"
            >
              Cancel
            </button>
          )}
          {(phase === "success" || phase === "error") && (
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-md bg-bg3 px-3.5 py-1.5 text-[11px] font-medium text-t2 hover:bg-hover"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  label,
  value,
  copied,
  onCopy,
  onOpen,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-t5">{label}</div>
      <div className="flex items-center gap-1 rounded-md border border-border bg-bg0 p-1.5 pl-2.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-t2">{value}</span>
        <button
          type="button"
          onClick={onCopy}
          className="rounded p-1 text-t4 hover:bg-hover hover:text-t2"
          title="Copy URL"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="rounded p-1 text-t4 hover:bg-hover hover:text-t2"
          title="Open in a new tab"
        >
          <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );
}
