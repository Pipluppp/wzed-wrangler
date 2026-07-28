import { create } from "zustand";
import {
  deployTemporaryPreview,
  type DeployStage,
} from "@/lib/cloudflare-deploy";
import { useNodepodStore } from "@/stores/nodepod-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getTemplateDefinition } from "@/templates";

export type DeployPhase =
  | "idle"
  | "consent"
  | DeployStage
  | "success"
  | "error";

interface DeployState {
  open: boolean;
  phase: DeployPhase;
  output: string;
  error: string | null;
  deploymentUrl: string | null;
  claimUrl: string | null;
  openDialog: () => void;
  closeDialog: () => void;
  cancel: () => void;
  deploy: () => Promise<void>;
}

let activeController: AbortController | null = null;
const runningPhases = new Set<DeployPhase>(["installing", "building", "deploying"]);

function appendOutput(previous: string, chunk: string): string {
  const next = `${previous}${chunk}`;
  return next.length > 30_000 ? next.slice(-30_000) : next;
}

export const useDeployStore = create<DeployState>((set, get) => ({
  open: false,
  phase: "idle",
  output: "",
  error: null,
  deploymentUrl: null,
  claimUrl: null,

  openDialog: () => {
    const project = useWorkspaceStore.getState().currentProject;
    const template = getTemplateDefinition(project?.templateId);
    if (!project || !template.deploymentKind) return;
    set({
      open: true,
      phase: "consent",
      output: "",
      error: null,
      deploymentUrl: null,
      claimUrl: null,
    });
  },

  closeDialog: () => {
    if (runningPhases.has(get().phase)) return;
    set({ open: false });
  },

  cancel: () => {
    activeController?.abort();
    activeController = null;
    set({ phase: "error", error: "Deployment cancelled" });
  },

  deploy: async () => {
    if (runningPhases.has(get().phase)) return;
    const nodepodState = useNodepodStore.getState();
    const workspace = useWorkspaceStore.getState();
    const template = getTemplateDefinition(workspace.currentProject?.templateId);
    if (!nodepodState.instance || !workspace.currentProject || !template.deploymentKind) {
      set({ phase: "error", error: "This project cannot be deployed" });
      return;
    }

    activeController = new AbortController();
    set({ phase: "installing", output: "", error: null });

    try {
      for (const file of Object.values(workspace.openFiles)) {
        if (!file.modified) continue;
        await nodepodState.instance.fs.writeFile(file.path, file.content);
        useWorkspaceStore.getState().markFileSaved(file.path);
      }

      const result = await deployTemporaryPreview(nodepodState.instance, {
        kind: template.deploymentKind,
        signal: activeController.signal,
        onStage: (phase) => set({ phase }),
        onOutput: (chunk) =>
          set((state) => ({ output: appendOutput(state.output, chunk) })),
      });

      set({
        phase: "success",
        deploymentUrl: result.deploymentUrl,
        claimUrl: result.claimUrl,
      });
      await useNodepodStore.getState().saveSnapshot();
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Deployment cancelled"
          : error instanceof Error
            ? error.message
            : "Deployment failed";
      set({ phase: "error", error: message });
    } finally {
      activeController = null;
    }
  },
}));
