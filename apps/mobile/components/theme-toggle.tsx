import { Pressable, View } from "react-native";
import { useColorScheme } from "nativewind";
import { Moon, Sun } from "lucide-react-native";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const toggleTheme = () => {
    setColorScheme(isDark ? "light" : "dark");
  };

  return (
    <Pressable
      onPress={toggleTheme}
      className={cn(
        "w-9 h-9 items-center justify-center rounded-md",
        "bg-secondary active:bg-secondary/80",
        className
      )}
    >
      {isDark ? (
        <Sun size={18} color="#fafafa" />
      ) : (
        <Moon size={18} color="#171717" />
      )}
    </Pressable>
  );
}

export function useTheme() {
  const { colorScheme, setColorScheme, toggleColorScheme } = useColorScheme();
  return {
    theme: colorScheme ?? "light",
    isDark: colorScheme === "dark",
    setTheme: setColorScheme,
    toggleTheme: toggleColorScheme,
  };
}
