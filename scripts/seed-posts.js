// Script to seed test posts using existing users
// Run with: npx ts-node scripts/seed-posts.ts

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://luljncadylctsrkqtatk.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1bGpuY2FkeWxjdHNya3F0YXRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MTU3MzQsImV4cCI6MjA4MTE5MTczNH0.eBow6AiXusEOnEG3O6TnkdjlFB7jeA6RcrnTpT0Ijts";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const testPosts = [
  "Just joined Cannect! Excited to connect with this amazing community. 🌱",
  "Building something cool today. The future of social is here! 💚",
  "Anyone else love how clean this app feels? Dark mode forever. 🖤",
  "Sharing my morning thoughts: Be kind, code hard, and drink coffee. ☕",
  "This is what happens when you focus on the user experience first. Cannect gets it right!",
  "Quote of the day: 'The best time to plant a tree was 20 years ago. The second best time is now.' 🌳",
  "Working on some exciting features. Can't wait to share more soon! 🚀",
  "Hot take: Simple design > feature bloat. Less is more.",
  "Good morning Cannect fam! What are you building today? 💪",
  "The community here is amazing. Glad to be part of it! 🙌"
];

async function seedPosts() {
  console.log("🌱 Fetching existing users...");
  
  // Get existing users
  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .limit(5);

  if (usersError) {
    console.error("Error fetching users:", usersError);
    return;
  }

  if (!users || users.length === 0) {
    console.log("❌ No users found. Please register some users first.");
    return;
  }

  console.log(`✅ Found ${users.length} users:`, users.map(u => u.username));

  console.log("\n📝 Inserting test posts...");

  for (let i = 0; i < testPosts.length; i++) {
    const user = users[i % users.length]; // Round-robin through users
    const content = testPosts[i];

    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: user.id,
        content,
        type: "post",
      })
      .select("id, content")
      .single();

    if (error) {
      console.error(`❌ Failed to insert post: ${error.message}`);
    } else {
      console.log(`✅ Post by @${user.username}: "${content.substring(0, 40)}..."`);
    }
  }

  console.log("\n🎉 Done seeding posts!");
}

seedPosts();
