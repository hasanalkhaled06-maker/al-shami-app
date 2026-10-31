update public.menu_items
set image_url = 'https://loremflickr.com/640/480/food,' || regexp_replace(lower(coalesce(name, 'meal')), '[^a-z0-9]+', ',', 'g') || '?lock=' || (abs(hashtext(id::text))::bigint % 2000000000)::text
where image_url is null or btrim(image_url) = '';
