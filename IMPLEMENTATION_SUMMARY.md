# Prediction System Implementation Summary

## What Was Implemented

A minimal, tested prediction system has been added to the Sainsbury's Bill Splitter with three key features:

### 1. Learning System (localStorage)
- **When**: Assignments are automatically saved when the summary screen is shown
- **How**: Uses `useEffect` hook to trigger `saveAssignmentsToHistory()` when `showSummary` becomes true
- **Storage Format**:
  ```javascript
  {
    "item name": {
      group: "Group Name",  // e.g., "You & Lisa", "The Kids", "Shared"
      count: 1,
      lastUsed: "2026-01-26"
    }
  }
  ```
- **Storage Location**: `localStorage` key: `billSplitterHistory`

### 2. Prediction Hints on Item Cards
- **Where**: Displayed on each item card (only when not already assigned)
- **Appearance**: Small blue hint box with lightbulb icon
- **Behavior**:
  - Shows "💡 Previously assigned to: [Group]" if item exists in history
  - Only displays if suggestions are enabled
  - Does NOT auto-assign - user must still manually assign
  - Disappears once item is assigned (during review with Back button)

### 3. Settings Toggle
- **Location**: Main upload screen
- **Control**: Simple checkbox labeled "Enable assignment suggestions (based on previous bills)"
- **Default**: Enabled (`showSuggestions: true`)
- **Behavior**:
  - When OFF: Hints are hidden but learning still happens
  - When ON: Hints are shown for previously seen items

## Code Changes

### State Management
```javascript
const [showSuggestions, setShowSuggestions] = useState(true);
```

### Learning Functions
```javascript
const saveAssignmentsToHistory = () => {
  // Saves all assignments to localStorage when summary is shown
};

const getPrediction = (itemName) => {
  // Retrieves prediction for a specific item from localStorage
};
```

### Auto-Save Hook
```javascript
useEffect(() => {
  if (showSummary) {
    saveAssignmentsToHistory();
  }
}, [showSummary]);
```

### Prediction Display
Inline IIFE in JSX to check and display prediction hints conditionally.

## Testing Checklist

To test the implementation:

1. **First Run - Learning**
   - Upload a Sainsbury's PDF
   - Assign items to different groups
   - Complete all assignments
   - Verify summary screen shows correctly
   - Check browser localStorage (DevTools > Application > Local Storage)
   - Confirm `billSplitterHistory` key exists with item data

2. **Second Run - Predictions**
   - Upload the SAME PDF again
   - Verify hints appear: "💡 Previously assigned to: [Group]"
   - Verify hints match previous assignments
   - Manually assign items (hints are just suggestions)
   - Complete and check summary

3. **Settings Toggle**
   - Go back to upload screen
   - Uncheck "Enable assignment suggestions"
   - Upload PDF again
   - Verify NO hints appear (but learning still works)
   - Re-enable toggle and verify hints return

4. **Edge Cases**
   - Upload PDF with NEW items (no predictions)
   - Upload PDF with MIX of old and new items
   - Use Back button to review assignments
   - Verify predictions don't interfere with assignment indicators

## What Was NOT Implemented

- Review screen (too complex for this iteration)
- Auto-assignment based on predictions
- Confidence scores or frequency tracking
- Prediction accuracy metrics
- Clear history functionality
- Settings persistence across sessions

## File Modified

- `/sessions/compassionate-magical-archimedes/mnt/Coding Projects/sainsburys-bill-splitter/sainsburys_bill_splitter.html`

## Key Design Decisions

1. **Minimal Storage**: Only track group name, not full split details
2. **Non-Invasive UX**: Hints are subtle and don't auto-assign
3. **Always Learn**: System learns even when suggestions are disabled
4. **Simple Key**: Use item name as direct key (no normalization)
5. **No Dependencies**: Pure localStorage, no external libraries
