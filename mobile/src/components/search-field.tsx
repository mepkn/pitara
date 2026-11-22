import { Search, X } from "lucide-react-native";
import { View } from "react-native";
import { CmpButton } from "@/components/cmp/cmp-button";
import { Input } from "@/components/ui/input";
import { strings } from "@/lib/strings";

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}

/** A search box with a clear button. `#tag` and `@collection` work in it (the server understands them). */
export function SearchField({ value, onChangeText, autoFocus, placeholder }: Props) {
  return (
    <View className="relative px-4 py-2">
      <Input
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? strings.search.placeholder}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="pl-9 pr-10"
        accessibilityLabel={strings.tabs.search}
      />
      <View className="absolute inset-y-2 left-7 justify-center" pointerEvents="none">
        <Search size={16} color="#8a7d6b" />
      </View>
      {value !== "" && (
        <View className="absolute inset-y-2 right-5 justify-center">
          <CmpButton variant="ghost" size="icon" icon={X} label={strings.search.clear} className="size-9" onPress={() => onChangeText("")} />
        </View>
      )}
    </View>
  );
}
