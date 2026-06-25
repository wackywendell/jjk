import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { getExtensionAPI } from "./extensionApi";
import type {
  BaseComparisonView,
  FileStatus,
  RepositoryStatus,
  Show,
} from "../repository";

suite("parseRenamePaths", () => {
  let parseRenamePaths: (
    file: string,
  ) => { fromPath: string; toPath: string } | null;

  suiteSetup(async () => {
    ({ parseRenamePaths } = (await getExtensionAPI()).repository);
  });

  test("should handle rename with no prefix or suffix", () => {
    const input = "{old => new}";
    const expected = {
      fromPath: "old",
      toPath: "new",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle rename with only suffix", () => {
    const input = "{old => new}.txt";
    const expected = {
      fromPath: "old.txt",
      toPath: "new.txt",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle rename with only prefix", () => {
    const input = "prefix/{old => new}";
    const expected = {
      fromPath: "prefix/old",
      toPath: "prefix/new",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle empty fromPart", () => {
    const input = "src/test/{ => basic-suite}/main.test.ts";
    const expected = {
      fromPath: "src/test/main.test.ts",
      toPath: "src/test/basic-suite/main.test.ts",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle empty toPart", () => {
    const input = "src/{old => }/file.ts";
    const expected = {
      fromPath: "src/old/file.ts",
      toPath: "src/file.ts",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should parse rename with leading and trailing directories", () => {
    const input = "a/b/{c => d}/e/f.txt";
    const expected = {
      fromPath: "a/b/c/e/f.txt",
      toPath: "a/b/d/e/f.txt",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle extra spaces within curly braces", () => {
    const input = "src/test/{  =>   basic-suite  }/main.test.ts";
    const expected = {
      fromPath: "src/test/main.test.ts",
      toPath: "src/test/basic-suite/main.test.ts",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle paths with dots in segments", () => {
    const input = "src/my.component/{old.module => new.module}/index.ts";
    const expected = {
      fromPath: "src/my.component/old.module/index.ts",
      toPath: "src/my.component/new.module/index.ts",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should handle paths with spaces", () => {
    // This test depends on how robust the regex is to special path characters.
    // The current regex is simple and might fail with complex characters.
    const input = "src folder/{a b => c d}/file name with spaces.txt";
    const expected = {
      fromPath: "src folder/a b/file name with spaces.txt",
      toPath: "src folder/c d/file name with spaces.txt",
    };
    assert.deepStrictEqual(parseRenamePaths(input), expected);
  });

  test("should return null for simple rename without curly braces", () => {
    const input = "old.txt => new.txt";
    assert.strictEqual(parseRenamePaths(input), null);
  });

  test("should return null for non-rename lines", () => {
    const input = "M src/some/file.ts";
    assert.strictEqual(parseRenamePaths(input), null);
  });

  test("should return null for empty input", () => {
    const input = "";
    assert.strictEqual(parseRenamePaths(input), null);
  });
});

suite("parseFileStatusLine", () => {
  let parseFileStatusLine: (
    repositoryRoot: string,
    line: string,
    out: FileStatus[],
  ) => boolean;

  const root = "/repo";

  suiteSetup(async () => {
    ({ parseFileStatusLine } = (await getExtensionAPI()).repository);
  });

  test("parses added file", () => {
    const out: FileStatus[] = [];
    assert.strictEqual(parseFileStatusLine(root, "A src/new.ts", out), true);
    assert.deepStrictEqual(out, [
      { type: "A", file: "src/new.ts", path: path.join(root, "src/new.ts") },
    ]);
  });

  test("parses modified file", () => {
    const out: FileStatus[] = [];
    parseFileStatusLine(root, "M lib/utils.ts", out);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, "M");
    assert.strictEqual(out[0].file, "lib/utils.ts");
  });

  test("parses deleted file", () => {
    const out: FileStatus[] = [];
    parseFileStatusLine(root, "D old-file.txt", out);
    assert.strictEqual(out[0].type, "D");
  });

  test("parses rename with brace syntax", () => {
    const out: FileStatus[] = [];
    parseFileStatusLine(root, "R src/{old => new}/file.ts", out);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, "R");
    assert.strictEqual(out[0].file, "src/new/file.ts");
    assert.strictEqual(out[0].renamedFrom, "src/old/file.ts");
  });

  test("parses copy", () => {
    const out: FileStatus[] = [];
    parseFileStatusLine(root, "C src/{a => b}.ts", out);
    assert.strictEqual(out[0].type, "C");
    assert.strictEqual(out[0].renamedFrom, "src/a.ts");
  });

  test("returns false for non-matching line", () => {
    const out: FileStatus[] = [];
    assert.strictEqual(
      parseFileStatusLine(root, "Working copy : abc123", out),
      false,
    );
    assert.strictEqual(out.length, 0);
  });

  test("returns false for empty line", () => {
    const out: FileStatus[] = [];
    assert.strictEqual(parseFileStatusLine(root, "", out), false);
  });

  test("appends to existing array", () => {
    const out: FileStatus[] = [
      { type: "A", file: "existing.ts", path: path.join(root, "existing.ts") },
    ];
    parseFileStatusLine(root, "M second.ts", out);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[1].type, "M");
  });
});

suite("getBaseComparisonTarget", () => {
  let getBaseComparisonTarget: (
    status: RepositoryStatus,
    parentShowResults: Map<string, Show>,
    showParentCommit: boolean,
  ) => string | null;
  let changeRev: typeof import("../repository").changeRev;
  let makeChangeId: typeof import("../repository").makeChangeId;

  suiteSetup(async () => {
    const api = await getExtensionAPI();
    const cls = api.repository.RepositorySourceControlManager;
    getBaseComparisonTarget = (status, parentShowResults, showParentCommit) =>
      cls.getBaseComparisonTarget(status, parentShowResults, showParentCommit);
    ({ changeRev, makeChangeId } = api.repository);
  });

  function makeChange(changeId: string): RepositoryStatus["parentChanges"][0] {
    return {
      changeId: makeChangeId({ full: changeId, display: changeId.slice(0, 3) }),
      commitId: `commit-${changeId}`,
      description: "",
      isEmpty: false,
      isConflict: false,
    };
  }

  function makeStatus(
    changeId: string,
    parentChangeIds: string[],
  ): RepositoryStatus {
    return {
      fileStatuses: [],
      workingCopy: makeChange(changeId),
      parentChanges: parentChangeIds.map(makeChange),
      conflictedFiles: new Set(),
    };
  }

  function makeShow(changeId: string, parentChangeIds: string[]): Show {
    return {
      change: {
        ...makeChange(changeId),
        author: { name: "someone", email: "someone@somewhere.com" },
        authoredDate: "sometime",
        parentChangeIds,
        parentCommitIds: parentChangeIds.map((id) => `commit-${id}`),
      },
      fileStatuses: [],
      conflictedFiles: new Set(),
    };
  }

  test("linear shows base comparison", () => {
    const grandparent = makeChange("grandparent");
    const parent = makeChange("parent");
    const child = makeChange("child");
    const status = makeStatus(changeRev(child), [changeRev(parent)]);

    const parentShow = makeShow(changeRev(parent), [changeRev(grandparent)]);
    const parentShowResults = new Map<string, Show>([
      [changeRev(parent), parentShow],
    ]);

    let shown = getBaseComparisonTarget(status, parentShowResults, true);
    assert.strictEqual(changeRev(grandparent), shown);
    shown = getBaseComparisonTarget(status, parentShowResults, false);
    assert.strictEqual(changeRev(parent), shown);
  });

  test("multiple parents, no base comparison", () => {
    const grandparent1 = makeChange("grandparent1");
    const parent1 = makeChange("parent1");
    const grandparent2 = makeChange("grandparent2");
    const parent2 = makeChange("parent2");
    const child = makeChange("child");
    const status = makeStatus(changeRev(child), [
      changeRev(parent1),
      changeRev(parent2),
    ]);

    const parent1Show = makeShow(changeRev(parent1), [changeRev(grandparent1)]);
    const parent2Show = makeShow(changeRev(parent2), [changeRev(grandparent2)]);
    const parentShowResults = new Map<string, Show>([
      [changeRev(parent1), parent1Show],
      [changeRev(parent2), parent2Show],
    ]);

    let shown = getBaseComparisonTarget(status, parentShowResults, true);
    assert.strictEqual(null, shown);
    shown = getBaseComparisonTarget(status, parentShowResults, false);
    assert.strictEqual(null, shown);
  });

  test("single parent, multiple grandparents", () => {
    const grandparent1 = makeChange("grandparent1");
    const grandparent2 = makeChange("grandparent2");
    const parent = makeChange("parent");
    const child = makeChange("child");
    const status = makeStatus(changeRev(child), [changeRev(parent)]);

    const parentShow = makeShow(changeRev(parent), [
      changeRev(grandparent1),
      changeRev(grandparent2),
    ]);
    const parentShowResults = new Map<string, Show>([
      [changeRev(parent), parentShow],
    ]);

    // If we're showing the parent, then base target is unclear - there are two
    // grandparents
    let shown = getBaseComparisonTarget(status, parentShowResults, true);
    assert.strictEqual(null, shown);

    // If we're not showing the parent, then base target is clear - its parent
    shown = getBaseComparisonTarget(status, parentShowResults, false);
    assert.strictEqual(changeRev(parent), shown);
  });

  test("missing show result", () => {
    const status = makeStatus("child", ["parent"]);
    const parentShowResults = new Map<string, Show>();
    const shown = getBaseComparisonTarget(status, parentShowResults, true);
    assert.strictEqual(null, shown);
  });
});

suite("parseChangesViewMode", () => {
  let parseChangesViewMode: typeof import("../repository").parseChangesViewMode;

  suiteSetup(async () => {
    ({ parseChangesViewMode } = (await getExtensionAPI()).repository);
  });

  test("accepts stack and cumulative values", () => {
    assert.strictEqual(parseChangesViewMode("stack"), "stack");
    assert.strictEqual(parseChangesViewMode("cumulative"), "cumulative");
  });

  test("maps the old workingCopy value to cumulative", () => {
    assert.strictEqual(parseChangesViewMode("workingCopy"), "cumulative");
  });

  test("defaults unknown values to stack", () => {
    assert.strictEqual(parseChangesViewMode(undefined), "stack");
    assert.strictEqual(parseChangesViewMode("nope"), "stack");
  });
});

suite("change labels", () => {
  let displayChangeId: typeof import("../repository").displayChangeId;
  let formatChangeStatusBarText: typeof import("../repository").formatChangeStatusBarText;
  let formatChangeLabel: typeof import("../repository").formatChangeLabel;
  let makeChangeId: typeof import("../repository").makeChangeId;

  suiteSetup(async () => {
    ({ displayChangeId, formatChangeStatusBarText, formatChangeLabel, makeChangeId } = (
      await getExtensionAPI()
    ).repository);
  });

  test("uses section name, shortest precise change id, and description", () => {
    assert.strictEqual(
      formatChangeLabel("Parent+", {
        changeId: makeChangeId({
          full: "npluquvnpkpprpozulnmossnkonzqskp",
          display: "rs",
        }),
        commitId: "commit",
        description: "describe labels",
        isEmpty: false,
        isConflict: false,
      }),
      "Parent+ [rs] • describe labels",
    );
  });

  test("formats change ids for display with the shortest precise id", () => {
    assert.strictEqual(
      displayChangeId({
        changeId: makeChangeId({
          full: "npluquvnpkpprpozulnmossnkonzqskp",
          display: "rs",
        }),
      }),
      "rs",
    );
  });

  test("keeps the full rev separate from the display id", () => {
    const changeId = makeChangeId({
      full: "npluquvnpkpprpozulnmossnkonzqskp",
      display: "rs",
    });

    assert.strictEqual(changeId.full, "npluquvnpkpprpozulnmossnkonzqskp");
    assert.strictEqual(changeId.display, "rs");
  });

  test("formats status bar text with the display id", () => {
    assert.strictEqual(
      formatChangeStatusBarText({
        changeId: makeChangeId({
          full: "npluquvnpkpprpozulnmossnkonzqskp",
          display: "rs",
        }),
      }),
      "$(git-commit) rs",
    );
  });

  test("shows status flags after the description", () => {
    assert.strictEqual(
      formatChangeLabel("Working Copy", {
        changeId: makeChangeId({
          full: "npluquvnpkpprpozulnmossnkonzqskp",
          display: "npl",
        }),
        commitId: "commit",
        description: "",
        isEmpty: true,
        isConflict: true,
      }),
      "Working Copy [npl] • (no description) (empty) (conflict)",
    );
  });
});

suite("base comparison view", () => {
  let createBaseComparisonView: typeof import("../repository").createBaseComparisonView;
  let getBaseComparisonLabel: typeof import("../repository").getBaseComparisonLabel;
  let toBaseComparisonResourceState: typeof import("../repository").toBaseComparisonResourceState;

  suiteSetup(async () => {
    ({
      createBaseComparisonView,
      getBaseComparisonLabel,
      toBaseComparisonResourceState,
    } = (await getExtensionAPI()).repository);
  });

  function makeFileStatus(): FileStatus {
    return {
      type: "M",
      file: "src/file.ts",
      path: path.join(path.sep, "repo", "src", "file.ts"),
    };
  }

  function uriParams(uri: { query: string }) {
    return JSON.parse(uri.query) as Record<string, string>;
  }

  test("stack mode uses jj revision resources", () => {
    const view = createBaseComparisonView({
      mode: "stack",
      baseRevision: "trunk()",
      toRevision: "parent",
    });
    const state = toBaseComparisonResourceState(makeFileStatus(), view);
    const args = state.command?.arguments as
      | [vscode.Uri, vscode.Uri, string]
      | undefined;
    assert.ok(args);

    assert.strictEqual(getBaseComparisonLabel(view), "Base: trunk()");
    assert.strictEqual(state.resourceUri.scheme, "jj");
    assert.strictEqual(uriParams(state.resourceUri).rev, "parent");
    assert.strictEqual(args[0].scheme, "jj");
    assert.strictEqual(uriParams(args[0]).rev, "trunk()");
    assert.strictEqual(args[1].scheme, "jj");
    assert.strictEqual(uriParams(args[1]).rev, "parent");
  });

  test("cumulative mode opens an editable file on the modified side", () => {
    const view = createBaseComparisonView({
      mode: "cumulative",
      baseRevision: "@--",
    });
    const state = toBaseComparisonResourceState(makeFileStatus(), view);
    const args = state.command?.arguments as
      | [vscode.Uri, vscode.Uri, string]
      | undefined;
    assert.ok(args);

    assert.strictEqual(getBaseComparisonLabel(view), "Base: @--");
    assert.strictEqual(
      getBaseComparisonLabel(view, "bad revset"),
      "Base: @-- (error: bad revset)",
    );
    assert.strictEqual(state.resourceUri.scheme, "jj");
    assert.strictEqual(uriParams(state.resourceUri).rev, "base-comparison");
    assert.strictEqual(args[0].scheme, "jj");
    assert.strictEqual(uriParams(args[0]).rev, "@--");
    assert.strictEqual(args[1].scheme, "file");
  });

  test("cumulative mode encodes its fixed target in the view", () => {
    const view: BaseComparisonView = createBaseComparisonView({
      mode: "cumulative",
      baseRevision: "trunk()",
    });

    assert.strictEqual(view.toRevision, "@");
    assert.strictEqual(view.decorationRev, "base-comparison");
  });
});

suite("parent section view", () => {
  let createParentSectionView: typeof import("../repository").createParentSectionView;
  let toParentSectionResourceState: typeof import("../repository").toParentSectionResourceState;

  suiteSetup(async () => {
    ({
      createParentSectionView,
      toParentSectionResourceState,
    } = (await getExtensionAPI()).repository);
  });

  const repositoryRoot = path.join(path.sep, "repo");

  function makeFileStatus(): FileStatus {
    return {
      type: "M",
      file: "src/file.ts",
      path: path.join(repositoryRoot, "src", "file.ts"),
    };
  }

  function uriParams(uri: { query: string }) {
    return JSON.parse(uri.query) as Record<string, string>;
  }

  test("stack parent sections use commit revision resources", () => {
    const view = createParentSectionView({
      mode: "commit",
      changeId: "parent",
    });
    const state = toParentSectionResourceState(
      makeFileStatus(),
      view,
      repositoryRoot,
    );
    const args = state.command?.arguments as
      | [vscode.Uri, vscode.Uri, string]
      | undefined;
    assert.ok(args);

    assert.strictEqual(state.resourceUri.scheme, "jj");
    assert.strictEqual(uriParams(state.resourceUri).rev, "parent");
    assert.strictEqual(args[0].scheme, "jj");
    assert.strictEqual(uriParams(args[0]).diffOriginalRev, "parent");
    assert.strictEqual(args[1].scheme, "jj");
    assert.strictEqual(uriParams(args[1]).rev, "parent");
  });

  test("cumulative parent sections open an editable file on the modified side", () => {
    const view = createParentSectionView({
      mode: "cumulative",
      changeId: "parent",
      baseRevision: "grandparent",
    });
    const state = toParentSectionResourceState(
      makeFileStatus(),
      view,
      repositoryRoot,
    );
    const args = state.command?.arguments as
      | [vscode.Uri, vscode.Uri, string]
      | undefined;
    assert.ok(args);

    assert.strictEqual(view.toRevision, "@");
    assert.strictEqual(state.resourceUri.scheme, "jj");
    assert.strictEqual(
      uriParams(state.resourceUri).rev,
      "parent-cumulative:parent",
    );
    assert.strictEqual(args[0].scheme, "jj");
    assert.strictEqual(uriParams(args[0]).rev, "grandparent");
    assert.strictEqual(args[1].scheme, "file");
  });

  test("cumulative parent sections read renamed files from the base path", () => {
    const view = createParentSectionView({
      mode: "cumulative",
      changeId: "parent",
      baseRevision: "grandparent",
    });
    const state = toParentSectionResourceState(
      {
        type: "R",
        file: "src/new.ts",
        path: path.join(repositoryRoot, "src", "new.ts"),
        renamedFrom: "src/old.ts",
      },
      view,
      repositoryRoot,
    );
    const args = state.command?.arguments as
      | [vscode.Uri, vscode.Uri, string]
      | undefined;
    assert.ok(args);

    assert.strictEqual(
      args[0].fsPath,
      path.join(repositoryRoot, "src", "old.ts"),
    );
    assert.strictEqual(
      args[1].fsPath,
      path.join(repositoryRoot, "src", "new.ts"),
    );
  });
});
