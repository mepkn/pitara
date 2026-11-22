import { X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { isValidTagName, normalizeTagName } from "@shared/tags";
import { LIMITS } from "@shared/limits";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpInput } from "@/components/cmp/cmp-field";
import { CmpText } from "@/components/cmp/cmp-text";
import { strings } from "@/lib/strings";
import { useTags } from "@/lib/use-data";

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

const SUGGESTIONS = 6;

/** Tag chips plus a field with suggestions from the user's existing tags. Names are normalised like the server does. */
export function TagInput({ tags, onChange }: Props) {
  const [text, setText] = useState("");
  const known = useTags();
  const name = normalizeTagName(text);
  const full = tags.length >= LIMITS.tagsPerBookmark;

  const suggestions = useMemo(() => {
    if (!known || full) return [];
    return known.rows
      .map((t) => t.name)
      .filter((n) => !tags.includes(n) && (name === "" || n.includes(name)))
      .slice(0, SUGGESTIONS);
  }, [known, tags, name, full]);

  function add(raw: string) {
    // Pasted or typed lists ("a, b") add several.
    const next = [...tags];
    for (const part of raw.split(",")) {
      const n = normalizeTagName(part);
      if (n !== "" && isValidTagName(n) && !next.includes(n) && next.length < LIMITS.tagsPerBookmark) next.push(n);
    }
    onChange(next);
    setText("");
  }

  return (
    <View className="gap-2">
      {tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {tags.map((t) => (
            <Pressable
              key={t}
              onPress={() => onChange(tags.filter((x) => x !== t))}
              accessibilityRole="button"
              accessibilityLabel={strings.form.removeTag(t)}
              className="bg-secondary active:bg-accent flex-row items-center gap-1 rounded-full py-1 pl-3 pr-2">
              <CmpText className="text-secondary-foreground text-sm">#{t}</CmpText>
              <CmpIcon as={X} size={14} className="text-muted-foreground" />
            </Pressable>
          ))}
        </View>
      )}
      <CmpInput
        value={text}
        onChangeText={(v) => (v.endsWith(",") ? add(v) : setText(v))}
        placeholder={strings.form.tagPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!full}
        maxLength={LIMITS.tagNameMax * 2}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={() => add(text)}
      />
      {(name !== "" || suggestions.length > 0) && (
        <View className="flex-row flex-wrap gap-1.5">
          {name !== "" && isValidTagName(name) && !tags.includes(name) && !full && (
            <Pressable
              onPress={() => add(name)}
              accessibilityRole="button"
              className="border-primary active:bg-accent rounded-full border px-3 py-1">
              <CmpText className="text-brand text-sm">{strings.form.addTag(name)}</CmpText>
            </Pressable>
          )}
          {suggestions
            .filter((s) => s !== name)
            .map((s) => (
              <Pressable
                key={s}
                onPress={() => add(s)}
                accessibilityRole="button"
                className="border-border active:bg-accent rounded-full border px-3 py-1">
                <CmpText className="text-sm">#{s}</CmpText>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}
