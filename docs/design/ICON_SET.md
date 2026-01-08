# Botanical Icon Set

**Version**: 1.0
**Style**: Organic botanical with hemp motifs
**Stroke**: 2px, round caps and joins
**ViewBox**: 24x24 (scalable to 16px, 32px)

---

## Design Principles

### Visual Style
- **Stroke width**: 2px (scales proportionally)
- **Line caps**: Round (`stroke-linecap="round"`)
- **Line joins**: Round (`stroke-linejoin="round"`)
- **Curves**: Organic bezier curves, avoid perfect circles/squares
- **Hemp motifs**: Subtle leaf shapes, fiber lines, bud clusters integrated into standard icons

### Color Usage
```css
/* Default state */
stroke: currentColor;  /* Inherits from parent */

/* Specific colors when needed */
--icon-default: var(--text-muted);    /* #8a9a8e light / #6b7a6f dark */
--icon-active: var(--gold-400);       /* #e4aa4f */
--icon-success: var(--green-500);     /* #668971 */
```

### Size Variants
| Size | ViewBox | Stroke | Usage |
|------|---------|--------|-------|
| 16px | 24x24 scaled | 2px | Inline text, small buttons |
| 24px | 24x24 | 2px | Standard icons |
| 32px | 24x24 scaled | 2.5px | Large icons, headers |

---

## Complete Icon Library

### 1. Dashboard (Hemp Leaf Data)
Grid with hemp leaf and data point
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Grid base -->
  <rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
  <rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
  <rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" stroke-width="2"/>
  <!-- Hemp leaf in bottom-right quadrant -->
  <path d="M17.5 14.5C17.5 14.5 15.5 16 15.5 18.5C15.5 16 13.5 14.5 13.5 14.5C13.5 14.5 15.5 13 15.5 10.5C15.5 13 17.5 14.5 17.5 14.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17.5 18.5C19.5 17 19.5 14.5 19.5 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M13.5 18.5C11.5 17 11.5 14.5 11.5 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Data dot -->
  <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/>
</svg>
```

### 2. Production (Bud Cluster)
Hemp bud with trichomes
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Main bud shape -->
  <path d="M12 4C8 4 6 8 6 12C6 16 8 20 12 20C16 20 18 16 18 12C18 8 16 4 12 4Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Calyx layers -->
  <path d="M9 8C9 8 10 10 12 10C14 10 15 8 15 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 12C8 12 9.5 14 12 14C14.5 14 16 12 16 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M9 16C9 16 10 17.5 12 17.5C14 17.5 15 16 15 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Trichome dots -->
  <circle cx="7" cy="10" r="1" fill="currentColor"/>
  <circle cx="17" cy="10" r="1" fill="currentColor"/>
  <circle cx="6.5" cy="14" r="1" fill="currentColor"/>
  <circle cx="17.5" cy="14" r="1" fill="currentColor"/>
</svg>
```

### 3. Analytics (Leaf Growth Chart)
Chart line forming into leaf
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Axes -->
  <path d="M3 3V21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Growth curve -->
  <path d="M7 17C7 17 9 14 12 12C15 10 17 7 17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Leaf at peak -->
  <path d="M17 7C17 7 19 5 21 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M17 7C17 7 19 7.5 20 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M17 7L18.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Data points -->
  <circle cx="7" cy="17" r="1.5" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="17" cy="7" r="1.5" fill="currentColor"/>
</svg>
```

### 4. Trimmers (Scissors with Leaf)
Scissors cutting a leaf
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Scissor handles -->
  <circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="2"/>
  <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
  <!-- Scissor blades -->
  <path d="M8.5 8L20 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8.5 16L20 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Small leaf being trimmed -->
  <path d="M16 12C16 12 14.5 10.5 14.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M16 12C16 12 17.5 10.5 17.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M16 12V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 5. Settings (Gear with Leaf Pattern)
Gear with hemp leaf texture inside
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Gear outer path -->
  <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" stroke-width="2"/>
  <path d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Hemp leaf pattern in center -->
  <path d="M12 10.5V13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M10.5 11.5L12 10.5L13.5 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 6. AI Chat (Hemp Flower)
Stylized hemp flower/chat bubble hybrid
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Chat bubble base -->
  <path d="M21 11.5C21.0034 12.8199 20.6951 14.1219 20.1 15.3C19.3944 16.7118 18.3098 17.8992 16.9674 18.7293C15.6251 19.5594 14.0782 19.9994 12.5 20C11.1801 20.0034 9.87812 19.6951 8.7 19.1L3 21L4.9 15.3C4.30493 14.1219 3.99656 12.8199 4 11.5C4.00061 9.92176 4.44061 8.37485 5.27072 7.03255C6.10083 5.69025 7.28825 4.6056 8.7 3.9C9.87812 3.30493 11.1801 2.99656 12.5 3H13C15.0843 3.11499 17.053 3.99476 18.5291 5.47086C20.0052 6.94696 20.885 8.91565 21 11V11.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Hemp leaf inside -->
  <path d="M12.5 8C12.5 8 10.5 9.5 10.5 12C10.5 9.5 8.5 8 8.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12.5 8C12.5 8 14.5 9.5 14.5 12C14.5 9.5 16.5 8 16.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12.5 12V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 7. Orders (Box with Leaf Seal)
Package with hemp leaf wax seal
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Box -->
  <path d="M21 8V21H3V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M23 3H1V8H23V3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10 12H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Hemp leaf seal -->
  <circle cx="12" cy="16" r="3" stroke="currentColor" stroke-width="2"/>
  <path d="M12 14V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M10.5 15L12 14L13.5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 8. Charts (Organic Line Graph)
Flowing organic chart line
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Axes with organic curve -->
  <path d="M3 3V21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Organic flowing line -->
  <path d="M7 14C8 12 9.5 13 11 11C12.5 9 14 10 16 7C17.5 4.5 19 6 21 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Area fill hint -->
  <path d="M7 14C8 12 9.5 13 11 11C12.5 9 14 10 16 7C17.5 4.5 19 6 21 4V21H7V14Z" fill="currentColor" opacity="0.1"/>
</svg>
```

### 9. Calendar (with Leaf)
Calendar with hemp leaf marker
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Calendar frame -->
  <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
  <path d="M16 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M3 10H21" stroke="currentColor" stroke-width="2"/>
  <!-- Hemp leaf marker -->
  <path d="M12 13C12 13 10.5 14 10.5 16C10.5 14 9 13 9 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 13C12 13 13.5 14 13.5 16C13.5 14 15 13 15 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 16V18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 10. Timer/Clock (Hemp Clock)
Clock with hemp leaf hands
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Clock face -->
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
  <!-- Hour markers -->
  <path d="M12 5V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M19 12H17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 19V17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M5 12H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Leaf-shaped hands -->
  <path d="M12 12V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Center dot -->
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>
```

### 11. Scale/Weight
Vintage scale with organic curves
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Base -->
  <path d="M5 21H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Center post -->
  <path d="M12 21V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Balance beam -->
  <path d="M4 8C4 8 8 7 12 8C16 9 20 8 20 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Left pan -->
  <path d="M4 8V11C4 12 5 13 7 13C9 13 10 12 10 11V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Right pan -->
  <path d="M14 8V11C14 12 15 13 17 13C19 13 20 12 20 11V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Top ornament -->
  <circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="2"/>
</svg>
```

### 12. Crew/Team (People with Leaf)
Group of people with botanical accent
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Center person -->
  <circle cx="12" cy="7" r="3" stroke="currentColor" stroke-width="2"/>
  <path d="M8 21V19C8 17.9391 8.42143 16.9217 9.17157 16.1716C9.92172 15.4214 10.9391 15 12 15C13.0609 15 14.0783 15.4214 14.8284 16.1716C15.5786 16.9217 16 17.9391 16 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Left person (smaller) -->
  <circle cx="5" cy="9" r="2" stroke="currentColor" stroke-width="2"/>
  <path d="M3 21V20C3 18.3431 4.34315 17 6 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Right person (smaller) -->
  <circle cx="19" cy="9" r="2" stroke="currentColor" stroke-width="2"/>
  <path d="M21 21V20C21 18.3431 19.6569 17 18 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Small leaf accent -->
  <path d="M12 3L13 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M12 3L11 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

### 13. Target (with Leaf Center)
Target with hemp leaf at bullseye
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Target rings -->
  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
  <circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2"/>
  <!-- Hemp leaf center -->
  <path d="M12 8C12 8 10 9.5 10 12C10 9.5 8 8 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 8C12 8 14 9.5 14 12C14 9.5 16 8 16 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 12V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 14. Refresh (Organic Arrows)
Circular arrows with organic curves
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Organic circular arrows -->
  <path d="M21 4V10H15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M3 20V14H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M21 10C20.2 7.2 18.3 4.9 15.7 3.7C13.1 2.5 10.1 2.5 7.5 3.6C4.9 4.8 2.9 7.1 2 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M3 14C3.8 16.8 5.7 19.1 8.3 20.3C10.9 21.5 13.9 21.5 16.5 20.4C19.1 19.2 21.1 16.9 22 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 15. Menu (Organic Lines)
Hamburger menu with organic line weights
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 6H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M4 12H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M4 18H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 16. Close (Organic X)
Slightly curved X for organic feel
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 17. Chevron Right
Organic arrow chevron
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 18. Chevron Down
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 19. Checkmark (Organic)
Flowing check with slight curve
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 13L9 17L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 20. Plus (Organic)
Plus with rounded feel
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 5V19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 21. Sun (Light Mode)
Sun with leaf-like rays
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Sun center -->
  <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
  <!-- Organic rays -->
  <path d="M12 2V5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 19V22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M4.22 4.22L6.34 6.34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M17.66 17.66L19.78 19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M2 12H5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M19 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M4.22 19.78L6.34 17.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M17.66 6.34L19.78 4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 22. Moon (Dark Mode)
Crescent moon with hemp star
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Moon crescent -->
  <path d="M21 12.79C20.8427 14.4922 20.2039 16.1144 19.1582 17.4668C18.1126 18.8192 16.7035 19.8458 15.0957 20.4265C13.4879 21.0073 11.748 21.1181 10.0795 20.7461C8.41104 20.3741 6.88299 19.5345 5.67423 18.3258C4.46546 17.117 3.62594 15.589 3.25391 13.9205C2.88187 12.252 2.99271 10.5121 3.57345 8.9043C4.1542 7.29651 5.18083 5.88737 6.53321 4.84175C7.88559 3.79614 9.50782 3.15731 11.21 3C10.2134 4.34827 9.73387 6.00945 9.85857 7.68141C9.98327 9.35338 10.7039 10.9251 11.8894 12.1106C13.0749 13.2961 14.6466 14.0167 16.3186 14.1414C17.9906 14.2661 19.6517 13.7866 21 12.79Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Star accent -->
  <path d="M17 6L17.5 4.5L19 4L17.5 3.5L17 2L16.5 3.5L15 4L16.5 4.5L17 6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 23. Collapse/Minimize
Organic collapse indicator
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 24. Expand
Organic expand indicator
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 5V19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 25. Drag Handle (Hemp Fiber Lines)
Six dots arranged as hemp fiber pattern
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="9" cy="6" r="1.5" fill="currentColor"/>
  <circle cx="15" cy="6" r="1.5" fill="currentColor"/>
  <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="9" cy="18" r="1.5" fill="currentColor"/>
  <circle cx="15" cy="18" r="1.5" fill="currentColor"/>
</svg>
```

### 26. Sound On (Speaker with Leaf)
Speaker with hemp wave
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Speaker body -->
  <path d="M11 5L6 9H2V15H6L11 19V5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Sound waves (organic curves) -->
  <path d="M15.54 8.46C16.4773 9.39764 17.0039 10.6692 17.0039 11.995C17.0039 13.3208 16.4773 14.5924 15.54 15.53" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M18.07 5.93C19.9447 7.80528 20.9979 10.3478 20.9979 13C20.9979 15.6522 19.9447 18.1947 18.07 20.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 27. Sound Off (Muted)
Speaker with X
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 5L6 9H2V15H6L11 19V5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M23 9L17 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M17 9L23 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

### 28. Send (Leaf Arrow)
Send arrow with organic flow
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 29. Resize (Organic Arrows)
Four-direction resize
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M15 3H21V9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M9 21H3V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M21 3L14 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M3 21L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

### 30. Hide/Eye Off
Eye with slash
```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.94 17.94C16.2306 19.243 14.1491 19.9649 12 20C5 20 1 12 1 12C2.24389 9.68192 3.96914 7.65663 6.06 6.06M9.9 4.24C10.5883 4.0789 11.2931 3.99836 12 4C19 4 23 12 23 12C22.393 13.1356 21.6691 14.2048 20.84 15.19M14.12 14.12C13.8454 14.4148 13.5141 14.6512 13.1462 14.8151C12.7782 14.9791 12.3809 15.0673 11.9781 15.0744C11.5753 15.0815 11.1752 15.0074 10.8016 14.8565C10.4281 14.7056 10.0887 14.4811 9.80385 14.1962C9.51897 13.9113 9.29439 13.5719 9.14351 13.1984C8.99262 12.8248 8.91853 12.4247 8.92563 12.0219C8.93274 11.6191 9.02091 11.2218 9.18488 10.8538C9.34884 10.4859 9.58525 10.1546 9.88 9.88" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M1 1L23 23" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

---

## Background Patterns

### Hemp Leaf Pattern (for backgrounds)
```svg
<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 5C25 10 20 15 20 25C20 30 25 35 30 40C35 35 40 30 40 25C40 15 35 10 30 5Z" fill="currentColor" opacity="0.12"/>
  <path d="M30 40V55" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.08"/>
</svg>
```
**Usage**: `background-size: 120px; opacity: 0.12;` (confident botanical)

### Hemp Fiber Texture (woven pattern)
```svg
<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 10h20M10 0v20" stroke="currentColor" stroke-width="0.5" opacity="0.1"/>
  <path d="M0 0l20 20M20 0l-20 20" stroke="currentColor" stroke-width="0.3" opacity="0.05"/>
</svg>
```
**Usage**: `background-size: 20px; opacity: 0.08;`

### Noise Texture (film grain)
```svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <filter id="noise">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#noise)"/>
</svg>
```
**Usage**: `opacity: 0.04;`

---

## Implementation Notes

### Using Icons in HTML
```html
<!-- Inline SVG (recommended for custom colors) -->
<svg class="icon" width="24" height="24" viewBox="0 0 24 24">
  <!-- path data here -->
</svg>

<!-- With CSS class for sizing -->
<style>
.icon { width: 24px; height: 24px; }
.icon-sm { width: 16px; height: 16px; }
.icon-lg { width: 32px; height: 32px; }
</style>
```

### Icon Colors with CSS
```css
/* Default color inherits from parent */
.icon {
  stroke: currentColor;
  fill: none;
}

/* Specific colors */
.icon-gold { color: var(--gold-400); }
.icon-green { color: var(--green-500); }
.icon-muted { color: var(--text-muted); }

/* Hover state */
.icon-interactive:hover {
  color: var(--gold-400);
  filter: drop-shadow(var(--glow-gold-sm));
}
```

### Icon Animation
```css
/* Hover scale */
.icon-interactive {
  transition: transform 200ms var(--ease-spring), color 200ms ease;
}
.icon-interactive:hover {
  transform: scale(1.1);
}

/* Spin for loading */
@keyframes spin {
  to { transform: rotate(360deg); }
}
.icon-spin {
  animation: spin 1s linear infinite;
}

/* Pulse for attention */
.icon-pulse {
  animation: pulse 2s ease-in-out infinite;
}
```

---

**Next**: See `COMPONENT_SPECS.md` for component-level specifications using these icons.
