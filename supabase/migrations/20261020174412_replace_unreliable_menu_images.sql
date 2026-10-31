
update public.menu_items
set image_url = case
  when lower(category) like '%pizza%' then 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%shawarma%' or lower(category) like '%sandwich%' or lower(category) like '%wrap%' then 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%burger%' then 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%chicken%' or lower(category) like '%roasted%' or lower(category) like '%fried%' then 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%rice%' or lower(category) like '%sauce%' then 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%fish%' then 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%spaghetti%' then 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%salad%' then 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%juice%' or lower(category) like '%drink%' then 'https://images.unsplash.com/photo-1513558161293-cdaf765edfd4?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%ice cream%' then 'https://images.unsplash.com/photo-1501446529957-6226bd447c46?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%shisha%' then 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%starter%' then 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=85'
  when lower(category) like '%platter%' then 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=800&q=85'
  else 'https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=800&q=85'
end;
select count(*) as total, count(*) filter (where image_url like 'https://images.unsplash.com/%') as with_stable_image_urls from public.menu_items;
