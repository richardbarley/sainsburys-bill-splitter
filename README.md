# Sainsbury's Bill Splitter

An interactive web tool to split Sainsbury's grocery bills between household members.

## Features

- **PDF Receipt Parsing**: Automatically extracts all items from Sainsbury's receipt PDFs
- **Quick Assignment**: One-click buttons to assign items to groups
- **Custom Percentage Splits**: Fine-tune splits with adjustable percentages per person
- **Quantity-Based Splits**: Divide multi-item purchases by quantity
- **Smart Auto-Redistribution**: Automatically adjusts percentages to always total 100%
- **Assignment Indicators**: See how items were previously assigned when reviewing
- **Individual Breakdowns**: Shows exactly how much each person owes

## How to Use

1. Open `sainsburys_bill_splitter.html` in your web browser
2. Upload your Sainsbury's receipt PDF (drag & drop or click to browse)
3. For each item, choose how to split amongst individuals
## Custom Splits

### Percentage Split
- Adjust each person's percentage using +/- buttons or manual input
- Remaining percentage automatically distributes among un-adjusted people
- Total always equals 100%
- Reset button returns to equal 6-way split

### Quantity Split
- For items with quantity > 1
- Allocate specific quantities to groups
- Cost calculated proportionally

## Technical Details

- Single HTML file - no installation required
- Uses React for UI
- PDF.js for PDF parsing
- Works offline once loaded
- 
## Browser Compatibility

Works in all modern browsers (Chrome, Firefox, Safari, Edge)
