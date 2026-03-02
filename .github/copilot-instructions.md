# Copilot Instructions for D&D Character Sheet App

## Project Overview
**Ficha-DND** is an Expo/React Native mobile app for creating and managing D&D 5e character sheets. It uses **Expo Router** for file-based navigation, **SQLite** for data persistence, and **React Native Reanimated** for animations. The app targets iOS, Android, and web platforms.

**Key Technologies:** Expo 54+, TypeScript, React Native 0.81, expo-sqlite, expo-router, LinearGradient, React Navigation

---

## Architecture & Data Flow

### File-Based Routing (Expo Router)
- **`src/app/_layout.tsx`**: Root layout wrapping entire app with `SQLiteProvider`, `ThemeProvider`, and `LinearGradient`
- **Routes:**
  - `/` (index): Home screen listing all characters
  - `/create`: Character creation wizard (6-step form)
  - `/sheet?id={characterId}`: Character sheet detail view for viewing/editing stats, inventory
  - `/sheet` loads from query params, not stack navigation

### Database Schema (SQLite)
- **`characters`**: Main table with id, name, race, class, stats (JSON), hp_max/hp_current, level, xp, equipment (JSON array), spells (JSON), coins (gp/sp/cp), personality fields, backstory
- **Support tables**: races, classes, skills, saving_throws, spells, items (weapon/armor catalog)
- Database initialization in `src/database/init.ts` with hardcoded seed data
- Columns storing JSON use `JSON.stringify()` on write, `JSON.parse()` on read

### Component Structure
- **`CharacterCard.tsx`**: Reusable card component with long-press menu, avatar via `ui-avatars.com` API
- **`sheet.tsx`**: Complex multi-tab view with "STATUS" and "MOCHILA" (inventory) tabs
- Modal patterns: Custom modals for item selection, HP/XP management, race/class dropdowns
- **Platform-specific files**: `*.web.tsx` and `*.module.css` for web overrides (e.g., `app-tabs.web.tsx`, `animated-icon.web.tsx`)

### State Management
- Uses React hooks (`useState`, `useEffect`) throughout
- `useSQLiteContext()` from expo-sqlite for database access
- `useLocalSearchParams()` and `useRouter()` from expo-router for navigation
- No Redux/Context API layer—state is local to screens or lifted to parent components

---

## Key Code Patterns & Conventions

### Styling & Theme
- **No CSS framework**: Direct `StyleSheet.create()` with hardcoded colors
- **Color scheme**: Primary blue (#00bfff), dark background (#102b56, #02112b), accent red (#ff6666), green (#00fa9a)
- **LinearGradient wrapper**: Applied at screen level for consistent background
- All numeric styles are inlined (padding, fontSize, borders) in StyleSheet objects
- **Responsive layout**: Uses `flex` extensively; widths in percentages for wrapping

### Database Operations
```typescript
// Read: await db.getFirstAsync(query, params)
// Read all: await db.getAllAsync(query)
// Write: await db.runAsync(query, params)
// Always stringify objects: JSON.stringify(stats), JSON.parse(result.stats || '{}')

// Update pattern from sheet.tsx:
const updateDB = async (updates: Partial<any>) => {
  const entries = Object.entries(updates);
  const setString = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([_, val]) => (typeof val === 'object' ? JSON.stringify(val) : val));
  await db.runAsync(`UPDATE characters SET ${setString} WHERE id = ?`, [...values, character.id]);
  setCharacter((prev: any) => ({ ...prev, ...updates }));
};
```

### Form Wizard Pattern (create.tsx)
- Multi-step progression via `step` state (1–6 for create flow)
- Each step validates before advancing; modals used for selection dialogs
- Starting equipment and gold auto-populate from class selection
- JSON lookup maps for game rules: `CLASS_SAVES`, `CLASS_HIT_DICE`, `RACE_SPEED`

### Modal & Overlay Pattern
```tsx
<Modal visible={visible} transparent animationType="fade">
  <Pressable style={styles.modalOverlay} onPress={handleClose}>
    <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
      {/* Modal content */}
    </Pressable>
  </Pressable>
</Modal>
```

### Type Definitions
- Inline types in component files (no separate types/ directory)
- Export types from components: `export type Character = {...}`
- `Partial<any>` used for flexible updates; consider stricter typing

---

## Development Workflow

### Scripts
```bash
npm start              # Start Expo dev server (choose platform interactively)
npm run android        # Build for Android emulator
npm run ios            # Build for iOS simulator
npm run web            # Serve web version
npm run lint           # Run ESLint
npm run reset-project  # Clear src/app and copy to app-example/
```

### Debugging
- Use React Native debugger or Expo's dev tools in terminal UI
- Console.error() used throughout for error logging
- No dedicated test suite; manual testing assumed

### Import Paths
- **Path alias** in `tsconfig.json`: `@/*` → `./src/*`
- Use `import { foo } from '@/components/...'` throughout
- Relative imports for same-directory files (e.g., `'../database/init'`)

---

## Common Tasks & Gotchas

### Adding a New Field to Characters
1. Add column to `characters` table in `src/database/init.ts`
2. Update `setCharacter()` parsing logic in screens (handle JSON if needed)
3. Add to `updateDB()` calls and state destructuring
4. If it's a complex object, store as JSON and parse on load

### Modifying Modals
- Always wrap content in double `<Pressable>` to prevent accidental closes
- Use `setModalVisible(false)` on action completion
- Keep input state (`inputValue`, `itemSearch`) separate to avoid cross-pollution

### Database Issues
- Database file: `dnd_sheet.db` persisted on device
- To reset during development: Uninstall app or run `npm run reset-project`
- Always use `JSON.stringify()` for objects, not direct insertion
- Use parameterized queries (`?` placeholders) to avoid SQL injection

### Styling on Web
- Create `.web.tsx` variants and `.module.css` for web-specific styles
- React Native Reanimated may need web fallbacks
- Test web build via `npm run web`

---

## Critical Files Reference
- **`src/app/_layout.tsx`**: Root setup, database initialization
- **`src/database/init.ts`**: Schema, seed data, database configuration
- **`src/app/sheet.tsx`**: Most complex screen; dual-tab character sheet with inventory
- **`src/app/create.tsx`**: Character creation wizard; contains most game rules (saves, hit dice, starting equipment)
- **`src/app/index.tsx`**: Home screen with character list
- **`src/constants/theme.ts`**: Color and spacing definitions (minimal; mostly in StyleSheet)

