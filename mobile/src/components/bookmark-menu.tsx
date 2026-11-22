import { BookOpen, CheckSquare, ExternalLink, FolderInput, Link2, Pencil, RotateCcw, Share2, Star, Trash2 } from "lucide-react-native";
import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpDialog } from "@/components/cmp/cmp-dialog";
import { displayTitle } from "@/components/bookmark-row";
import { strings } from "@/lib/strings";
import type { Bookmark } from "@/lib/use-bookmark-list";

export type MenuAction = "open" | "edit" | "select" | "favorite" | "unread" | "move" | "copy" | "share" | "trash" | "restore" | "deleteForever";

interface Props {
  bookmark: Bookmark | undefined;
  onClose: () => void;
  onAction: (action: MenuAction, bookmark: Bookmark) => void;
}

function Item({ icon, label, tone, onPress }: { icon: LucideIcon; label: string; tone?: "destructive"; onPress: () => void }) {
  return <CmpButton variant="ghost" className="justify-start" icon={icon} label={label} tone={tone} onPress={onPress} />;
}

/** The long-press menu of one bookmark: Edit, Copy link, Share, Move, Select… */
export function BookmarkMenu({ bookmark: b, onClose, onAction }: Props) {
  const m = strings.menu;
  const go = (action: MenuAction) => {
    if (b) onAction(action, b);
  };
  return (
    <CmpDialog open={b !== undefined} onOpenChange={(open) => !open && onClose()} title={b ? displayTitle(b) : ""}>
      {b && (
        <View>
          <Item icon={ExternalLink} label={m.open} onPress={() => go("open")} />
          {b.deletedAt === undefined ? (
            <>
              <Item icon={Pencil} label={m.edit} onPress={() => go("edit")} />
              <Item icon={CheckSquare} label={m.select} onPress={() => go("select")} />
              <Item icon={Star} label={b.favorite ? m.unstar : m.star} onPress={() => go("favorite")} />
              <Item icon={BookOpen} label={b.unread ? m.markRead : m.markUnread} onPress={() => go("unread")} />
              <Item icon={FolderInput} label={m.move} onPress={() => go("move")} />
              <Item icon={Link2} label={m.copyLink} onPress={() => go("copy")} />
              <Item icon={Share2} label={m.share} onPress={() => go("share")} />
              <Item icon={Trash2} label={m.trash} tone="destructive" onPress={() => go("trash")} />
            </>
          ) : (
            <>
              <Item icon={Link2} label={m.copyLink} onPress={() => go("copy")} />
              <Item icon={RotateCcw} label={m.restore} onPress={() => go("restore")} />
              <Item icon={Trash2} label={m.deleteForever} tone="destructive" onPress={() => go("deleteForever")} />
            </>
          )}
        </View>
      )}
    </CmpDialog>
  );
}
