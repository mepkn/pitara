import { ChevronDown, ChevronUp, FolderOpen, Star, BookOpen } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { LIMITS } from "@shared/limits";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpFieldFrame, CmpInput } from "@/components/cmp/cmp-field";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpText } from "@/components/cmp/cmp-text";
import { CmpSwitch } from "@/components/cmp/cmp-switch";
import { CollectionPicker } from "@/components/collection-picker";
import { TagInput } from "@/components/tag-input";
import { strings } from "@/lib/strings";
import { collectionPath } from "@/lib/tree";
import { useCollections, type CollectionId } from "@/lib/use-data";

export interface BookmarkDraft {
  url: string;
  title: string;
  description: string;
  note: string;
  collectionId: CollectionId | null;
  tags: string[];
  favorite: boolean;
  unread: boolean;
}

export const EMPTY_DRAFT: BookmarkDraft = {
  url: "",
  title: "",
  description: "",
  note: "",
  collectionId: null,
  tags: [],
  favorite: false,
  unread: false,
};

interface Props {
  draft: BookmarkDraft;
  onChange: (draft: BookmarkDraft) => void;
  /** Show the address field (add and edit; the share sheet shows the address as text). */
  editableUrl?: boolean;
  /** Show title and description (edit) rather than hiding them under "More fields". */
  full?: boolean;
  urlError?: string;
  error?: string;
  submitLabel: string;
  submitting?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
}

function Toggle({ label, icon, value, onChange }: { label: string; icon: typeof Star; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} className="flex-1 flex-row items-center gap-2">
      <CmpIcon as={icon} size={18} className={value ? "text-brand" : "text-muted-foreground"} />
      <CmpText className="flex-1">{label}</CmpText>
      <CmpSwitch checked={value} onCheckedChange={onChange} />
    </Pressable>
  );
}

/** The bookmark fields shared by Add, Edit and the share sheet. */
export function BookmarkForm({ draft, onChange, editableUrl = true, full = false, urlError, error, submitLabel, submitting, disabled, onSubmit }: Props) {
  const collections = useCollections();
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState(full);
  const set = <K extends keyof BookmarkDraft>(key: K, value: BookmarkDraft[K]) => onChange({ ...draft, [key]: value });
  const collectionLabel =
    draft.collectionId === null || !collections ? strings.form.unsorted : collectionPath(collections.rows, draft.collectionId) || strings.form.unsorted;

  return (
    <View className="gap-4">
      {editableUrl && (
        <CmpInput
          label={strings.form.url}
          value={draft.url}
          onChangeText={(v) => set("url", v)}
          placeholder={strings.form.urlPlaceholder}
          error={urlError}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          maxLength={LIMITS.urlMax}
        />
      )}
      {(full || more) && (
        <CmpInput
          label={full ? strings.form.title : strings.form.titleOptional}
          hint={full ? undefined : strings.form.titleHint}
          value={draft.title}
          onChangeText={(v) => set("title", v)}
          maxLength={LIMITS.titleMax}
        />
      )}
      <CmpFieldFrame label={strings.form.collection}>
        <CmpButton variant="outline" className="justify-start" icon={FolderOpen} label={collectionLabel} onPress={() => setPicking(true)} />
      </CmpFieldFrame>
      <CmpFieldFrame label={strings.form.tags}>
        <TagInput tags={draft.tags} onChange={(tags) => set("tags", tags)} />
      </CmpFieldFrame>
      <CmpInput
        label={strings.form.note}
        value={draft.note}
        onChangeText={(v) => set("note", v)}
        multiline
        textAlignVertical="top"
        className="h-24 py-2"
        maxLength={LIMITS.noteMax}
      />
      {(full || more) && (
        <CmpInput
          label={strings.form.description}
          value={draft.description}
          onChangeText={(v) => set("description", v)}
          multiline
          textAlignVertical="top"
          className="h-24 py-2"
          maxLength={LIMITS.descriptionMax}
        />
      )}
      <View className="gap-3">
        <Toggle label={strings.form.favorite} icon={Star} value={draft.favorite} onChange={(v) => set("favorite", v)} />
        <Toggle label={strings.form.unread} icon={BookOpen} value={draft.unread} onChange={(v) => set("unread", v)} />
      </View>
      {!full && (
        <CmpButton variant="ghost" icon={more ? ChevronUp : ChevronDown} label={more ? strings.form.less : strings.form.more} onPress={() => setMore(!more)} />
      )}
      {error && <CmpText className="text-destructive text-sm">{error}</CmpText>}
      <CmpButton label={submitLabel} loading={submitting} disabled={disabled} onPress={onSubmit} />
      <CollectionPicker open={picking} onOpenChange={setPicking} value={draft.collectionId} onPick={(id) => set("collectionId", id)} />
    </View>
  );
}
