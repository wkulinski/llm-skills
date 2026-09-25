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
const playwrightReference = read(".agents/skills/_shared/references/playwright-cli-verification.md");
const reportFormat = read(".agents/skills/frontend-ui-consistency/references/report-format.md");

describe("frontend application access contract", () => {
    it("declares only the documented Playwright environment keys", () => {
        const expectedKeys = [
            "PLAYWRIGHT_GUI_BASE_URL",
            "PLAYWRIGHT_GUI_LOGIN_URL",
            "PLAYWRIGHT_GUI_STORAGE_STATE",
            "PLAYWRIGHT_GUI_USER_LOGIN",
            "PLAYWRIGHT_GUI_USER_PASSWORD",
        ];
        const declaredKeys = [...envDist.matchAll(/^PLAYWRIGHT_GUI_[A-Z_]+=/gm)].map((match) => match[0].slice(0, -1));

        expect([...declaredKeys].sort()).toEqual([...expectedKeys].sort());
        expect(envDist).toContain(".playwright-cli/auth/");
        expect(envDist).not.toContain("PLAYWRIGHT_GUI_AUTH_RECIPE");
    });

    it("makes URL selection explicit and never supplies a localhost route", () => {
        expect(skill).toMatch(/explicit prompt\/task URL -> `PLAYWRIGHT_GUI_BASE_URL` ->\s+ask user or blocker/);
        expect(skill).toMatch(/Nigdy nie zgaduj trasy i nigdy nie\s+ustawiaj domyślnie `localhost`\./);
        expect(readme).toContain("Nie zgaduj trasy i nie używaj domyślnego `localhost`.");
        expect(playwrightReference).toContain("Nie używaj domyślnego `localhost`.");
        expect(playwrightReference).not.toContain("open http://localhost");
    });

    it("requires a safe, ignored repository-relative regular state file", () => {
        expect(skill).toContain("_shared/references/playwright-cli-verification.md");
        expect(playwrightReference).toContain("repo-relative");
        expect(playwrightReference).toContain(".playwright-cli/auth/");
        expect(playwrightReference).toContain("regular file");
        expect(playwrightReference).toContain("git check-ignore");
        expect(gitignore).toMatch(/^\/\.playwright-cli\/$/m);
    });

    it("loads state before protected navigation and classifies auth failures", () => {
        const lifecycle = playwrightReference.match(/```bash\nAPP_SESSION=[\s\S]*?```/)?.[0] ?? "";
        const stateLoad = lifecycle.indexOf('state-load "$STATE_FILE"');
        const protectedNavigation = lifecycle.indexOf('goto "$RESOLVED_APPLICATION_URL"');

        expect(stateLoad).toBeGreaterThan(-1);
        expect(protectedNavigation).toBeGreaterThan(stateLoad);
        expect(skill).toContain("authentication unavailable");
        expect(playwrightReference).toContain("Błąd `state-load` klasyfikuj jako `authentication unavailable`.");
    });

    it("documents the state, bootstrap, unavailable order and loopback scope without a recipe key", () => {
        const stateStep = playwrightReference.indexOf("**Stan istnieje**");
        const bootstrapStep = playwrightReference.indexOf("**Bootstrap**");
        const unavailableStep = playwrightReference.indexOf("**Brak możliwości uwierzytelnienia**");

        expect(stateStep).toBeGreaterThan(-1);
        expect(bootstrapStep).toBeGreaterThan(stateStep);
        expect(unavailableStep).toBeGreaterThan(bootstrapStep);

        for (const source of [playwrightReference, skill, readme]) {
            expect(source).toContain("_shared/scripts/playwright-access-prepare.sh");
            expect(source).not.toContain("PLAYWRIGHT_GUI_AUTH_RECIPE");
        }
        expect(playwrightReference).toContain("_shared/scripts/playwright-auth-bootstrap.sh");
        expect(skill).toContain("_shared/scripts/playwright-auth-bootstrap.sh");

        expect(skill).toContain("_shared/scripts/playwright-auth-bootstrap.mjs");
        expect(playwrightReference).toContain("`localhost`, `127.0.0.1`, `::1`");
        expect(skill).toMatch(/`localhost`,\s*`127\.0\.0\.1`, `::1`/);
        expect(reportFormat).toContain("created via bootstrap");
    });

    it("requires separate unique sessions and cleanup for the application checkpoint", () => {
        expect(skill).toContain("infrastructure preflight");
        expect(skill).toContain("separate unique session");
        expect(skill).toMatch(/własną sesję\s+zawsze zakończ/);
        expect(playwrightReference).toContain('APP_SESSION="ui-review-<task>-application"');
        expect(playwrightReference).toContain('"$PW_CLI" -s="$APP_SESSION" close');
        expect(playwrightReference).toContain('"$PW_CLI" -s="$APP_SESSION" detach');
        expect(playwrightReference).toMatch(/Sesja preflightu jest\s+własnością helpera i helper ją sprząta/);
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
