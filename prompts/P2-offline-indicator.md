# P2-004: Offline State Indicator

| Field | Value |
|-------|-------|
| **Agent Type** | Feature Engineer |
| **Complexity** | Low |
| **Branch Name** | `feat/offline-indicator` |
| **Blocked By** | None |
| **Created** | 2024-12 |

---

## Objective

Add a visual indicator when the user loses network connectivity, improving UX transparency.

---

## Context

QA confirmed that offline message queuing works correctly:
- Messages are queued locally when offline
- Messages are sent automatically upon reconnection
- No data loss occurs

However, users receive no visual feedback that they're offline, which could cause confusion. Users may think the app is broken when messages don't send immediately.

---

## Design Requirements

### Visual Design
- Non-intrusive banner or subtle indicator (not a modal or popup)
- Position: Top of screen (below header) or integrated into header
- Background: Muted warning color (amber/yellow) or neutral gray
- Icon: Wifi-off or cloud-off icon
- Text: "You're offline - messages will send when reconnected"

### Behavior
- Appears within 2 seconds of connectivity loss
- Disappears within 2 seconds of reconnection
- Should not block any user interactions
- Should not repeatedly flash if connection is unstable

### Accessibility
- Sufficient color contrast (WCAG AA)
- Screen reader announcement on state change
- No motion/animation that could cause issues

---

## Relevant Files

### Components
- `packages/web/src/components/` - UI components directory
- `packages/web/src/components/chat/chat-view.tsx` - Main chat view
- `packages/web/src/components/providers.tsx` - Global providers

### Hooks
- `packages/web/src/hooks/` - Check for existing network status hook

### Styles
- Check existing design system for toast/banner components
- Look for existing color variables for warning states

---

## Implementation Approach

### Option A: Custom Hook + Banner Component

```typescript
// hooks/use-network-status.ts
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
```

```typescript
// components/offline-banner.tsx
export function OfflineBanner() {
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div role="alert" className="offline-banner">
      <WifiOffIcon />
      <span>You're offline - messages will send when reconnected</span>
    </div>
  );
}
```

### Option B: Integrate into Existing Toast System

If there's an existing toast/notification system, use that instead of creating a new component. The offline state would be a persistent toast that auto-dismisses on reconnection.

---

## Acceptance Criteria

- [ ] Banner/indicator appears when `navigator.onLine` becomes false
- [ ] Banner/indicator disappears when connectivity restored
- [ ] Indicator is visible but non-intrusive
- [ ] Message sending still works (queue + retry behavior unchanged)
- [ ] Works on mobile viewports (responsive)
- [ ] No console errors or warnings
- [ ] Accessible (screen reader compatible)

---

## Constraints

**Do NOT:**
- Block user interaction while offline
- Show error toasts for individual message send failures (queuing handles this)
- Add complex retry logic (already exists in message handling)
- Create a modal or dialog (too intrusive)
- Modify the existing message queue behavior

---

## Testing

### Manual Test Procedure

1. Open the app in Chrome
2. Open DevTools > Network tab
3. Set to "Offline" mode
4. Verify banner appears within 2 seconds
5. Try sending a message (should be queued, no error shown)
6. Set Network back to "Online"
7. Verify banner disappears
8. Verify queued message sends

### Mobile Testing

1. Test on actual mobile device
2. Toggle airplane mode
3. Verify banner appears and is readable on small screen
4. Verify banner doesn't overlap important UI elements

---

## Related

- QA Report: `.playwright-mcp/` - scenario_c_offline_test.png
- Does not block any other prompts
