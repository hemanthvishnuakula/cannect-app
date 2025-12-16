-- Seed posts function (SECURITY DEFINER bypasses RLS)
-- This allows seeding test data without authentication

CREATE OR REPLACE FUNCTION seed_test_posts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_ids uuid[];
  user_id uuid;
  i int;
  posts text[] := ARRAY[
    'Just joined Cannect! Excited to connect with this amazing community. 🌱',
    'Building something cool today. The future of social is here! 💚',
    'Anyone else love how clean this app feels? Dark mode forever. 🖤',
    'Sharing my morning thoughts: Be kind, code hard, and drink coffee. ☕',
    'This is what happens when you focus on the user experience first. Cannect gets it right!',
    'Quote of the day: The best time to plant a tree was 20 years ago. The second best time is now. 🌳',
    'Working on some exciting features. Cant wait to share more soon! 🚀',
    'Hot take: Simple design > feature bloat. Less is more.',
    'Good morning Cannect fam! What are you building today? 💪',
    'The community here is amazing. Glad to be part of it! 🙌',
    'Just shipped a new feature. Feels good to see it live!',
    'Testing out the quote post feature. This is pretty slick! 🔥',
    'Pro tip: Take breaks. Your code will thank you later.',
    'New week, new goals. Lets make it count! 📈',
    'Loving the vibes on this platform. Keep building! 🛠️'
  ];
BEGIN
  -- Get up to 5 user IDs
  SELECT array_agg(id) INTO user_ids
  FROM (SELECT id FROM profiles LIMIT 5) sub;
  
  IF user_ids IS NULL OR array_length(user_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No users found. Please register some users first.';
  END IF;
  
  -- Insert posts, cycling through users
  FOR i IN 1..array_length(posts, 1) LOOP
    user_id := user_ids[((i - 1) % array_length(user_ids, 1)) + 1];
    
    INSERT INTO posts (user_id, content, type, is_repost, is_reply)
    VALUES (user_id, posts[i], 'post', false, false);
  END LOOP;
  
  RAISE NOTICE 'Successfully seeded % posts across % users', array_length(posts, 1), array_length(user_ids, 1);
END;
$$;

-- Execute the function to seed posts
SELECT seed_test_posts();

-- Clean up - drop the function after use (optional, keeps it for future seeding)
-- DROP FUNCTION seed_test_posts();
