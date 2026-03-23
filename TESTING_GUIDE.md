# Testing Guide - Prediction System

## Quick Test Procedure

### Step 1: Open the Application
1. Open `sainsburys_bill_splitter.html` in a web browser
2. You should see the main upload screen
3. Look for the checkbox at the bottom: "Enable assignment suggestions"

### Step 2: First Bill - Learning Phase
1. Upload a Sainsbury's receipt PDF
2. Assign items to groups (You & Lisa, The Kids, Shared, or Custom)
3. Complete all items
4. View the summary screen
5. **Behind the scenes**: Assignments are now saved to localStorage

### Step 3: Verify Learning Worked
1. Open Browser DevTools (F12)
2. Go to: Application > Storage > Local Storage > file://
3. Look for key: `billSplitterHistory`
4. Click to view the stored data
5. You should see JSON like:
   ```json
   {
     "Item Name 1": {
       "group": "You & Lisa",
       "count": 1,
       "lastUsed": "2026-01-26"
     },
     "Item Name 2": {
       "group": "The Kids",
       "count": 1,
       "lastUsed": "2026-01-26"
     }
   }
   ```

### Step 4: Second Bill - Prediction Phase
1. Click "Start Over" or refresh the page
2. Upload the SAME PDF again
3. As you go through items, watch for blue hint boxes:
   ```
   💡 Previously assigned to: You & Lisa
   ```
4. These hints appear ONLY for items that were in the previous bill
5. The hints are suggestions - you can still assign differently

### Step 5: Test Settings Toggle
1. Go back to the upload screen (refresh page)
2. **Uncheck** "Enable assignment suggestions"
3. Upload the same PDF
4. **Result**: No hints appear (but system still learns)
5. Go back and **check** the toggle again
6. Upload the same PDF
7. **Result**: Hints reappear

## What to Look For

### Success Indicators
✅ Hints appear for previously seen items
✅ Hints show the correct group name
✅ Hints only appear when toggle is ON
✅ Hints disappear after assignment (when reviewing)
✅ localStorage contains assignment data
✅ System still works without predictions

### Common Issues
❌ No hints appearing → Check DevTools console for errors
❌ Hints showing wrong group → Clear localStorage and retry
❌ Toggle not working → Hard refresh (Ctrl+Shift+R)

## Manual Testing Scenarios

### Scenario 1: New Items (No Predictions)
- Upload a DIFFERENT PDF with new items
- Expected: No hints appear
- Expected: Items still get learned after summary

### Scenario 2: Mixed Items
- Upload a PDF with some old and some new items
- Expected: Hints only for previously seen items
- Expected: All items get learned

### Scenario 3: Different Assignment
- Upload same PDF
- See hint: "Previously assigned to: You & Lisa"
- Assign to "The Kids" instead
- Complete to summary
- Expected: Next time, hint shows "The Kids"

### Scenario 4: Custom Splits
- Assign item with Custom Split
- Expected: Next time, hint shows "Custom Split"
- Note: Exact percentages are NOT restored, just the label

### Scenario 5: Toggle Behavior
- Disable toggle BEFORE uploading
- Upload and assign items
- Expected: No hints, but learning happens
- Enable toggle and upload again
- Expected: Hints appear from previous learning

## Clear History (If Needed)

To reset the prediction system:
1. Open DevTools (F12)
2. Application > Local Storage
3. Right-click `billSplitterHistory`
4. Click "Delete"
5. Refresh page

## Browser Compatibility

Tested on:
- Chrome/Edge (Recommended)
- Firefox
- Safari

Note: localStorage must be enabled in browser settings.
