"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useDeferredValue,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { ResumePreview } from "@/components/resume/resume-preview";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import {
  type EditorSection,
  type EditorState,
  emptySection,
  fromEditor,
  toEditor,
} from "@/lib/resume/editor";
import {
  LAYOUT_LABELS,
  type Layout,
  type ResumeContent,
  resumeContentSchema,
} from "@/lib/resume/structured";

type Note = { where: string; message: string };

/**
 * Profile → Resume: the structured (master) resume as a form, grouped by the
 * user's own sections, with the printed page next to it (below it on a
 * phone, behind a Preview tab). This is the user's own resume, so unlike
 * tailoring they may rename, add, remove or reorder sections here.
 */
export function ResumeEditor({
  initial,
  notes,
  save,
  clearNotes,
  saveLabel = "Save resume",
}: {
  initial: ResumeContent;
  notes: Note[];
  save: (content: ResumeContent) => Promise<ActionResult>;
  clearNotes: () => Promise<ActionResult>;
  saveLabel?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>(() => toEditor(initial));
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [pending, startTransition] = useTransition();
  const content = useMemo(() => fromEditor(state), [state]);
  const preview = useDeferredValue(content);

  function change(next: (draft: EditorState) => void) {
    setState((current) => {
      const draft = structuredClone(current);
      next(draft);
      return draft;
    });
    setDirty(true);
  }

  function submit() {
    const parsed = resumeContentSchema.safeParse(content);
    if (!parsed.success) {
      toast.error(
        `Something is too long: ${parsed.error.issues[0]?.path.join(" → ")}.`,
      );
      return;
    }
    startTransition(async () => {
      const result = await save(parsed.data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDirty(false);
      toast.success("Resume saved.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {notes.length > 0 && (
        <ImportNotes notes={notes} clearNotes={clearNotes} />
      )}

      <div
        role="tablist"
        aria-label="Resume view"
        className="flex gap-1 rounded-lg bg-muted p-1 lg:hidden"
      >
        {(["edit", "preview"] as const).map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className="flex-1 rounded-md px-3 py-1.5 text-sm font-medium aria-selected:bg-background aria-selected:shadow-sm"
          >
            {name === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={tab === "edit" ? "block" : "hidden lg:block"}>
          <FieldGroup>
            <HeaderFields state={state} change={change} />
            {state.sections.map((section, index) => (
              <SectionCard
                key={section.key}
                section={section}
                index={index}
                count={state.sections.length}
                change={change}
              />
            ))}
            <AddSection
              onAdd={(title, layout) =>
                change((d) => {
                  d.sections.push(emptySection(title, layout));
                })
              }
            />
          </FieldGroup>
        </div>
        <div className={tab === "preview" ? "block" : "hidden lg:block"}>
          <div className="lg:sticky lg:top-4">
            <ResumePreview content={preview} />
          </div>
        </div>
      </div>

      <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur md:bottom-4">
        <Button onClick={submit} disabled={pending || !dirty}>
          {pending ? "Saving…" : saveLabel}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </div>
    </div>
  );
}

function ImportNotes({
  notes,
  clearNotes,
}: {
  notes: Note[];
  clearNotes: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div
      role="region"
      aria-label="Check these"
      className="rounded-xl border border-warning bg-warning/10 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert aria-hidden="true" className="size-4" />
        Check these against your file
      </p>
      <p className="mt-1 text-muted-foreground">
        The import is meant to copy your resume exactly. These parts don&apos;t
        match your file word for word. Fix them below if they&apos;re wrong.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {notes.map((note, i) => (
          <li key={i}>
            <span className="font-medium">{note.where}:</span> {note.message}
          </li>
        ))}
      </ul>
      <Button
        className="mt-3"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await clearNotes();
            if (!result.ok) toast.error(result.message);
            else router.refresh();
          })
        }
      >
        I&apos;ve checked them
      </Button>
    </div>
  );
}

type Change = (next: (draft: EditorState) => void) => void;

function HeaderFields({
  state,
  change,
}: {
  state: EditorState;
  change: Change;
}) {
  const id = useId();
  const { header } = state;
  const text = (
    key: "name" | "email" | "phone" | "location",
    label: string,
    type = "text",
  ) => (
    <Field>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        type={type}
        value={header[key] ?? ""}
        onChange={(e) =>
          change((d) => {
            d.header[key] = e.target.value;
          })
        }
      />
    </Field>
  );
  return (
    <fieldset className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <legend className="px-1 font-medium">Name and contact</legend>
      {text("name", "Name")}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("email", "Email", "email")}
        {text("phone", "Phone", "tel")}
      </div>
      {text("location", "Location (city, state)")}
      {header.links.map((link, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field>
            <FieldLabel htmlFor={`${id}-link-${i}-label`}>Link text</FieldLabel>
            <Input
              id={`${id}-link-${i}-label`}
              value={link.label}
              onChange={(e) =>
                change((d) => {
                  d.header.links[i].label = e.target.value;
                })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-link-${i}-url`}>Address</FieldLabel>
            <Input
              id={`${id}-link-${i}-url`}
              type="url"
              value={link.url}
              onChange={(e) =>
                change((d) => {
                  d.header.links[i].url = e.target.value;
                })
              }
            />
          </Field>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove link ${link.label || i + 1}`}
            onClick={() =>
              change((d) => {
                d.header.links.splice(i, 1);
              })
            }
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      {header.links.length < 8 && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              change((d) => {
                d.header.links.push({ label: "", url: "" });
              })
            }
          >
            <Plus aria-hidden="true" />
            Add a link
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function SectionCard({
  section,
  index,
  count,
  change,
}: {
  section: EditorSection;
  index: number;
  count: number;
  change: Change;
}) {
  const id = useId();
  const name = section.title || "Untitled section";
  const edit = (fn: (s: EditorSection) => void) =>
    change((d) => fn(d.sections[index]));

  return (
    <fieldset
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
      aria-label={name}
    >
      <div className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor={`${id}-title`}>
            Section title{" "}
            <span className="font-normal text-muted-foreground">
              · {LAYOUT_LABELS[section.layout]}
            </span>
          </FieldLabel>
          <Input
            id={`${id}-title`}
            value={section.title}
            onChange={(e) =>
              edit((s) => {
                s.title = e.target.value;
              })
            }
          />
        </Field>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Move ${name} up`}
          disabled={index === 0}
          onClick={() =>
            change((d) => {
              const [moved] = d.sections.splice(index, 1);
              d.sections.splice(index - 1, 0, moved);
            })
          }
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Move ${name} down`}
          disabled={index === count - 1}
          onClick={() =>
            change((d) => {
              const [moved] = d.sections.splice(index, 1);
              d.sections.splice(index + 1, 0, moved);
            })
          }
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${name}`}
          onClick={() =>
            change((d) => {
              d.sections.splice(index, 1);
            })
          }
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      {section.layout === "entries" && (
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel htmlFor={`${id}-pairs`} className="font-normal">
            Beside each title on the first line
          </FieldLabel>
          <Select
            value={section.headingPairsWith ?? "dates"}
            onValueChange={(value) =>
              edit((s) => {
                if (s.layout === "entries") {
                  s.headingPairsWith = value as "dates" | "location";
                }
              })
            }
          >
            <SelectTrigger id={`${id}-pairs`} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dates">Dates</SelectItem>
              <SelectItem value="location">Location</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {section.layout === "text" && (
        <Field>
          <FieldLabel htmlFor={`${id}-text`}>Text</FieldLabel>
          <Textarea
            id={`${id}-text`}
            value={section.text}
            onChange={(e) =>
              edit((s) => {
                if (s.layout === "text") s.text = e.target.value;
              })
            }
          />
        </Field>
      )}

      {section.layout === "entries" &&
        section.items.map((entry, i) => (
          <div key={i} className="flex flex-col gap-3 border-t pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["heading", "Name (e.g. company, school, project)"],
                  ["dates", "Dates"],
                  ["subheading", "Second line (e.g. role, degree)"],
                  ["location", "Location"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`${id}-${i}-${key}`}>{label}</FieldLabel>
                  <Input
                    id={`${id}-${i}-${key}`}
                    value={entry[key]}
                    onChange={(e) =>
                      edit((s) => {
                        if (s.layout === "entries")
                          s.items[i][key] = e.target.value;
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-${i}-bullets`}>
                Bullets, one per line
              </FieldLabel>
              <Textarea
                id={`${id}-${i}-bullets`}
                aria-describedby={`${id}-${i}-bullets-bold`}
                value={entry.bullets}
                onChange={(e) =>
                  edit((s) => {
                    if (s.layout === "entries")
                      s.items[i].bullets = e.target.value;
                  })
                }
              />
              <FieldDescription id={`${id}-${i}-bullets-bold`}>
                **Double asterisks** around words make them bold.
              </FieldDescription>
            </Field>
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  edit((s) => {
                    if (s.layout === "entries") s.items.splice(i, 1);
                  })
                }
              >
                <Trash2 aria-hidden="true" />
                Remove {entry.heading || "this entry"}
              </Button>
            </div>
          </div>
        ))}

      {section.layout === "list" &&
        section.items.map((item, i) => (
          <div
            key={i}
            className="grid grid-cols-[8rem_1fr_auto] items-end gap-2"
          >
            <Field>
              <FieldLabel htmlFor={`${id}-${i}-label`}>Label</FieldLabel>
              <Input
                id={`${id}-${i}-label`}
                value={item.label}
                onChange={(e) =>
                  edit((s) => {
                    if (s.layout === "list") s.items[i].label = e.target.value;
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-${i}-values`}>
                Items, separated by commas
              </FieldLabel>
              <Input
                id={`${id}-${i}-values`}
                value={item.values}
                onChange={(e) =>
                  edit((s) => {
                    if (s.layout === "list") s.items[i].values = e.target.value;
                  })
                }
              />
            </Field>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${item.label || "this line"}`}
              onClick={() =>
                edit((s) => {
                  if (s.layout === "list") s.items.splice(i, 1);
                })
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}

      {section.layout !== "text" && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              edit((s) => {
                if (s.layout === "entries")
                  s.items.push({
                    heading: "",
                    subheading: "",
                    dates: "",
                    location: "",
                    bullets: "",
                  });
                else if (s.layout === "list")
                  s.items.push({ label: "", values: "" });
              })
            }
          >
            <Plus aria-hidden="true" />
            {section.layout === "entries" ? "Add an entry" : "Add a line"}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function AddSection({
  onAdd,
}: {
  onAdd: (title: string, layout: Layout) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [layout, setLayout] = useState<Layout>("entries");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-4">
      <Field className="min-w-40 flex-1">
        <FieldLabel htmlFor={`${id}-title`}>New section</FieldLabel>
        <Input
          id={`${id}-title`}
          value={title}
          placeholder="e.g. Awards"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field className="w-auto">
        <FieldLabel htmlFor={`${id}-layout`}>Kind</FieldLabel>
        <Select value={layout} onValueChange={(v) => setLayout(v as Layout)}>
          <SelectTrigger id={`${id}-layout`} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LAYOUT_LABELS) as Layout[]).map((value) => (
              <SelectItem key={value} value={value}>
                {LAYOUT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        variant="outline"
        disabled={!title.trim()}
        onClick={() => {
          onAdd(title.trim(), layout);
          setTitle("");
        }}
      >
        <Plus aria-hidden="true" />
        Add section
      </Button>
    </div>
  );
}
