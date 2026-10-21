# AL SHAMI — Improvement Backlog

This is a prioritized implementation and verification backlog, not a claim that every item is already implemented. Preserve all existing orders and customer records. Electronic payments remain deferred. Every database permission or financial calculation change must be tested before release.

## Customer ordering and conversion

- [ ] 1. Guest checkout without mandatory account
- [ ] 2. Remember customer name and phone on the same device with consent
- [ ] 3. Validate Ghana phone numbers before submission
- [ ] 4. Keep checkout fields after a network error
- [ ] 5. Prevent duplicate submissions while an order is processing
- [ ] 6. Show a clear order reference after successful save
- [ ] 7. Offer WhatsApp contact after order success
- [ ] 8. Show delivery and pickup choices clearly
- [ ] 9. Require delivery address only for delivery orders
- [ ] 10. Show address field examples and landmark guidance
- [ ] 11. Show item quantity controls with accessible labels
- [ ] 12. Allow removing individual cart items
- [ ] 13. Confirm before clearing a non-empty cart
- [ ] 14. Persist cart locally across refreshes
- [ ] 15. Restore cart only when menu item IDs still exist
- [ ] 16. Recalculate totals after every quantity change
- [ ] 17. Display subtotal, delivery fee and total consistently
- [ ] 18. Explain cash-on-delivery and pickup payment
- [ ] 19. Show minimum-order rule before checkout
- [ ] 20. Disable checkout when cart is empty
- [ ] 21. Show inline field validation
- [ ] 22. Focus the first invalid field
- [ ] 23. Protect against double-click order submission
- [ ] 24. Display useful offline/network error messages
- [ ] 25. Show a loading state during menu fetch
- [ ] 26. Provide retry action when menu loading fails
- [ ] 27. Offer menu search by name
- [ ] 28. Offer category filtering
- [ ] 29. Keep search and category filters compatible
- [ ] 30. Show empty search results helpfully
- [ ] 31. Add sort by price and popularity
- [ ] 32. Mark unavailable items clearly
- [ ] 33. Prevent adding unavailable items to cart
- [ ] 34. Show item descriptions consistently
- [ ] 35. Show item images with graceful fallback
- [ ] 36. Use lazy loading for long menu images
- [ ] 37. Use responsive image dimensions
- [ ] 38. Show offer expiry/availability where configured
- [ ] 39. Avoid showing inactive promotions
- [ ] 40. Make offers readable on mobile
- [ ] 41. Provide order summary before final submit
- [ ] 42. Use clear button labels instead of ambiguous icons
- [ ] 43. Ensure all controls work with keyboard
- [ ] 44. Support screen readers for cart changes
- [ ] 45. Support reduced motion
- [ ] 46. Keep important content usable at 320px width
- [ ] 47. Provide tap-friendly controls
- [ ] 48. Show restaurant phone links
- [ ] 49. Provide WhatsApp links to both restaurant numbers
- [ ] 50. Make address and location easy to copy

## Menu and promotions

- [ ] 51. Admin can add menu items
- [ ] 52. Admin can edit menu items
- [ ] 53. Admin can archive rather than destructively delete items
- [ ] 54. Validate item names and prices
- [ ] 55. Prevent negative prices
- [ ] 56. Validate image URLs before saving
- [ ] 57. Preview item image before saving
- [ ] 58. Support menu item availability toggle
- [ ] 59. Support menu item categories
- [ ] 60. Support category ordering
- [ ] 61. Support menu item display ordering
- [ ] 62. Support promotion active/inactive state
- [ ] 63. Validate promotion titles
- [ ] 64. Show promotion start and end dates
- [ ] 65. Automatically hide expired promotions
- [ ] 66. Avoid conflicting promotion application
- [ ] 67. Document promotion eligibility rules
- [ ] 68. Show item-level special instructions
- [ ] 69. Track menu price change timestamps
- [ ] 70. Provide menu export backup
- [ ] 71. Provide menu import with validation
- [ ] 72. Warn about duplicate menu names
- [ ] 73. Show menu update timestamp to admins
- [ ] 74. Show loading and error states for menu management
- [ ] 75. Confirm potentially destructive menu actions

## Orders and kitchen workflow

- [ ] 76. List new orders prominently
- [ ] 77. Filter orders by status
- [ ] 78. Search orders by number and phone
- [ ] 79. Sort orders by newest first
- [ ] 80. Show order age in minutes
- [ ] 81. Highlight stale unaccepted orders
- [ ] 82. Provide one-click accept action
- [ ] 83. Provide preparing status
- [ ] 84. Provide ready status
- [ ] 85. Provide completed status
- [ ] 86. Provide cancellation with reason
- [ ] 87. Prevent invalid status transitions
- [ ] 88. Record status-change timestamp
- [ ] 89. Record staff member changing order status
- [ ] 90. Keep order item snapshots stable after menu price changes
- [ ] 91. Show customer contact action
- [ ] 92. Show delivery address clearly
- [ ] 93. Show pickup versus delivery badge
- [ ] 94. Show order notes prominently
- [ ] 95. Print kitchen ticket
- [ ] 96. Print customer receipt
- [ ] 97. Provide print-friendly order view
- [ ] 98. Handle printer failure with clear message
- [ ] 99. Prevent accidental duplicate completion
- [ ] 100. Require payment confirmation before cash completion
- [ ] 101. Separate cancelled orders from active queue
- [ ] 102. Show daily order count
- [ ] 103. Show daily completed sales
- [ ] 104. Export orders by date range
- [ ] 105. Preserve order records; use cancellation instead of deletion

## Inventory and purchasing

- [ ] 106. Maintain stock item units consistently
- [ ] 107. Prevent negative stock adjustments without a reason
- [ ] 108. Record stock receipts
- [ ] 109. Record stock usage
- [ ] 110. Record stock waste
- [ ] 111. Record stock corrections with reason
- [ ] 112. Record the staff member for each movement
- [ ] 113. Show current stock balance
- [ ] 114. Show low-stock warnings
- [ ] 115. Configure per-item reorder threshold
- [ ] 116. Track supplier names and contacts
- [ ] 117. Create purchase orders
- [ ] 118. Track purchase order status
- [ ] 119. Receive only physically delivered stock
- [ ] 120. Prevent receiving the same purchase twice
- [ ] 121. Record received quantity separately from ordered quantity
- [ ] 122. Record purchase unit cost
- [ ] 123. Calculate weighted average cost if supported
- [ ] 124. Link recipes to menu items
- [ ] 125. Validate recipe quantities and units
- [ ] 126. Deduct recipe ingredients once per eligible order
- [ ] 127. Prevent duplicate inventory deduction per order
- [ ] 128. Record deduction references for audit
- [ ] 129. Reverse stock deductions safely on eligible cancellations
- [ ] 130. Show stock movement history
- [ ] 131. Filter stock movements by date and item
- [ ] 132. Export stock report
- [ ] 133. Show inventory valuation with documented costing method
- [ ] 134. Warn when a recipe references missing inventory
- [ ] 135. Warn when recipe quantities are implausible
- [ ] 136. Provide stocktake workflow
- [ ] 137. Record stocktake variance
- [ ] 138. Track expiry dates for perishable stock
- [ ] 139. Flag soon-to-expire inventory
- [ ] 140. Track supplier delivery lead times

## Cash, accounting and reports

- [ ] 141. Open cash shift with opening balance
- [ ] 142. Allow one open shift per cashier if desired by policy
- [ ] 143. Record shift opener and opening time
- [ ] 144. Calculate expected cash using documented rules
- [ ] 145. Record counted closing cash
- [ ] 146. Calculate cash over/short
- [ ] 147. Require closing note when variance exists
- [ ] 148. Record cash payouts
- [ ] 149. Require payout reason and amount
- [ ] 150. Prevent negative payout amounts
- [ ] 151. Record expenses with category
- [ ] 152. Require expense date and description
- [ ] 153. Support cash, mobile money, bank and other payment labels
- [ ] 154. Keep payment method separate from order status
- [ ] 155. Avoid double-counting expenses and payouts
- [ ] 156. Show sales by date range
- [ ] 157. Show sales by order type
- [ ] 158. Show sales by payment method when data supports it
- [ ] 159. Show expenses by category
- [ ] 160. Show gross sales and refunds separately
- [ ] 161. Show estimated operating result with clear caveats
- [ ] 162. Show order count and average order value
- [ ] 163. Compare selected period with previous period
- [ ] 164. Export reports as CSV
- [ ] 165. Escape CSV values safely
- [ ] 166. Include report date range in exports
- [ ] 167. Use local Ghana time consistently
- [ ] 168. Use GH₵ formatting consistently
- [ ] 169. Validate date range start is not after end
- [ ] 170. Display empty report states
- [ ] 171. Prevent report exports when no report has been run
- [ ] 172. Document whether sales are grouped by order date or completion date
- [ ] 173. Track cash payout versus owner drawing distinction
- [ ] 174. Support daily close checklist

## Staff, roles and accountability

- [ ] 175. Create staff profiles
- [ ] 176. Edit staff profiles safely
- [ ] 177. Deactivate staff instead of deleting historical records
- [ ] 178. Assign staff roles
- [ ] 179. Enforce role permissions in the database, not only UI
- [ ] 180. Limit owner-only settings to authorized users
- [ ] 181. Track attendance check-in
- [ ] 182. Track attendance check-out
- [ ] 183. Prevent duplicate active check-in
- [ ] 184. Record attendance editor
- [ ] 185. Show attendance by date
- [ ] 186. Export attendance report
- [ ] 187. Record audit entries for sensitive changes
- [ ] 188. Track who changed prices
- [ ] 189. Track who changed order status
- [ ] 190. Track who recorded expenses
- [ ] 191. Track who received stock
- [ ] 192. Track who opened and closed shifts
- [ ] 193. Use least-privilege database policies
- [ ] 194. Provide session sign-out
- [ ] 195. Handle expired admin sessions gracefully
- [ ] 196. Show admin access errors without exposing secrets
- [ ] 197. Never put service-role keys in browser code
- [ ] 198. Review every SECURITY DEFINER function
- [ ] 199. Keep customer data access minimal
- [ ] 200. Avoid exposing customer phone numbers in public menu queries

## Reliability, security and maintenance

- [ ] 201. Keep Supabase API responses out of service-worker cache
- [ ] 202. Use network-first app shell updates
- [ ] 203. Version static cache names on releases
- [ ] 204. Remove obsolete caches on activation
- [ ] 205. Show clear offline state
- [ ] 206. Provide offline fallback for app shell
- [ ] 207. Never claim an order was saved before database confirmation
- [ ] 208. Handle slow network timeouts gracefully
- [ ] 209. Retry only safe read operations automatically
- [ ] 210. Do not blindly retry order creation
- [ ] 211. Validate database RPC inputs server-side
- [ ] 212. Validate order item IDs and quantities server-side
- [ ] 213. Calculate authoritative prices server-side
- [ ] 214. Calculate delivery fees server-side
- [ ] 215. Enforce minimum order server-side
- [ ] 216. Use database transactions for order and item creation
- [ ] 217. Add rate limiting to public order submission where available
- [ ] 218. Add anti-spam measures that do not block genuine customers
- [ ] 219. Review Row Level Security on every public table
- [ ] 220. Test anon versus authenticated permissions
- [ ] 221. Review function execute grants
- [ ] 222. Review database indexes using actual query patterns
- [ ] 223. Avoid indexes without demonstrated query need
- [ ] 224. Enable leaked-password protection when auth is used
- [ ] 225. Keep dependency versions controlled and reviewed
- [ ] 226. Avoid unnecessary third-party scripts
- [ ] 227. Add error logging without customer secrets
- [ ] 228. Add request correlation IDs where practical
- [ ] 229. Back up schema and critical configuration
- [ ] 230. Document restore procedure
- [ ] 231. Maintain a staging/test environment
- [ ] 232. Run automated syntax checks before publishing
- [ ] 233. Run end-to-end order smoke test after deployment
- [ ] 234. Test on iPhone Safari
- [ ] 235. Test on Android Chrome
- [ ] 236. Test on desktop Chrome and Firefox
- [ ] 237. Test slow and interrupted connections
- [ ] 238. Test empty database states
- [ ] 239. Test 100+ menu items for responsiveness
- [ ] 240. Add release notes for each deployment

## Design, accessibility and growth

- [ ] 241. Improve semantic page landmarks
- [ ] 242. Add skip navigation link
- [ ] 243. Provide visible keyboard focus
- [ ] 244. Respect reduced-motion preference
- [ ] 245. Use sufficiently large tap targets
- [ ] 246. Improve color contrast for muted text
- [ ] 247. Label every form field programmatically
- [ ] 248. Provide accessible status announcements
- [ ] 249. Prevent success dialog focus from being lost
- [ ] 250. Return focus after closing dialogs
- [ ] 251. Add Open Graph title and description
- [ ] 252. Use descriptive page title
- [ ] 253. Use search-engine description metadata
- [ ] 254. Use descriptive image alt text
- [ ] 255. Avoid layout shift while images load
- [ ] 256. Keep typography readable on small screens
- [ ] 257. Make cart totals visually distinct
- [ ] 258. Use consistent empty states
- [ ] 259. Use consistent error states
- [ ] 260. Use consistent success messages
- [ ] 261. Add contact CTA near ordering flow
- [ ] 262. Make WhatsApp links safe with noopener
- [ ] 263. Make phone links tap-to-call
- [ ] 264. Make address easy to find
- [ ] 265. Show opening hours only when verified
- [ ] 266. Add map link only after confirming exact pin
- [ ] 267. Track order conversion only with privacy-conscious analytics
- [ ] 268. Measure menu-load time
- [ ] 269. Measure checkout error rate without storing sensitive details
- [ ] 270. Test customer flow with a real low-risk test order and then clearly cancel/label it


**Total backlog items: 270.** Work through these in stages: customer ordering, order operations, inventory, accounting, staff controls, security, then polish and verification. Mark an item complete only after code change and a relevant test.