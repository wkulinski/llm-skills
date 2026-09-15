import {readFileSync} from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

function read(relativePath) {
    return readFileSync(path.join(ROOT, relativePath), "utf8");
}

const envDist = read(".env.dist");
const gitignore = read(".gitignore");
const skill = read(".agents/skills/frontend-ui-consistency/SKILL.md");
const readme = read(".agents/skills/frontend-ui-consistency/README.md");
const playwrightReference = read(".agents/skills/frontend-ui-consistency/references/playwright-cli-verification.md");
const reportFormat = read(".agents/skills/frontend-ui-consistency/references/report-format.md");

describe("frontend application access contract", () => {
    it("declares the application URL and optional storage-state environment keys", () => {
        for (const key of [
            "PLAYWRIGHT_GUI_BASE_URL",
            "PLAYWRIGHT_GUI_LOGIN_URL",
            "PLAYWRIGHT_GUI_STORAGE_STATE",
        ]) {
            expect(envDist.match(new RegExp(`^${key}=`, "gm"))).toHaveLength(1);
        }

        expect(envDist).toContain(".playwright-cli/auth/");
    });

    it("makes URL selection explicit and never supplies a localhost route", () => {
        expect(skill).toMatch(/explicit prompt\/task URL -> `PLAYWRIGHT_GUI_BASE_URL` ->\s+ask user or blocker/);
        expect(skill).toMatch(/Nigdy nie zgaduj trasy i nigdy nie\s+ustawiaj domyślnie `localhost`\./);
        expect(readme).toContain("Nie zgaduj trasy i nie używaj domyślnego `localhost`.");
        expect(playwrightReference).toContain("Nie używaj domyślnego `localhost`.");
        expect(playwrightReference).not.toContain("open http://localhost");
    });

    it("requires a safe, ignored repository-relative regular state file", () => {
        expect(skill).toContain("repo-relative");
        expect(skill).toContain(".playwright-cli/auth/");
        expect(skill).toContain("regular file");
        expect(skill).toContain("Git-ignored");
        expect(skill).toContain("git check-ignore");
        expect(gitignore).toMatch(/^\/\.playwright-cli\/$/m);
    });

    it("loads state before protected navigation and classifies auth failures", () => {
        const lifecycle = playwrightReference.match(/```bash\nAPP_SESSION=[\s\S]*?```/)?.[0] ?? "";
        const stateLoad = lifecycle.indexOf("state-load <filename>");
        const protectedNavigation = lifecycle.indexOf('goto "$RESOLVED_APPLICATION_URL"');

        expect(stateLoad).toBeGreaterThan(-1);
        expect(protectedNavigation).toBeGreaterThan(stateLoad);
        expect(skill).toContain("authentication unavailable");
        expect(playwrightReference).toContain("Błąd `state-load` klasyfikuj jako `authentication unavailable`.");
        expect(skill).toMatch(/nie\s+stosuj fallbacku do generycznego `fill`/);
        expect(playwrightReference).toContain("Nie próbuj\ngenerycznego `fill`");
    });

    it("requires separate unique sessions and cleanup for the application checkpoint", () => {
        expect(skill).toContain("infrastructure preflight");
        expect(skill).toContain("separate unique session");
        expect(skill).toContain("własną sesję zawsze zamknij");
        expect(playwrightReference).toContain('APP_SESSION="ui-review-<task>-application"');
        expect(playwrightReference).toContain('"$PW_CLI" -s="$APP_SESSION" close');
        expect(playwrightReference).toContain("Sesja preflightu jest\nwłasnością helpera i helper ją zamyka");
    });

    it("resolves a single Playwright CLI entrypoint for the application session", () => {
        expect(playwrightReference).toContain('PW_CLI="$(resolve_tool_cmd playwright-cli playwright-cli)"');

        const lifecycle = playwrightReference.match(/```bash\nAPP_SESSION=[\s\S]*?```/)?.[0] ?? "";
        expect(lifecycle).toContain('"$PW_CLI" -s="$APP_SESSION"');
        expect(lifecycle).not.toContain("playwright-cli -s=");

        expect(playwrightReference).not.toMatch(/^\s*playwright-cli -s=/m);
        expect(skill).toContain("resolve_tool_cmd");
        expect(readme).toContain("resolve_tool_cmd");
    });

    it("keeps Browser, Application, and Authentication outcomes distinct in reports", () => {
        expect(reportFormat).toContain("**Browser**");
        expect(reportFormat).toContain("**Application**");
        expect(reportFormat).toContain("**Authentication**");
        expect(reportFormat).toContain("Browser outcome:");
        expect(reportFormat).toContain("Application outcome:");
        expect(reportFormat).toContain("Authentication outcome:");
        expect(reportFormat).toContain("authentication unavailable");
    });
});
