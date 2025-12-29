# 🌿 Cannect

A decentralized cannabis social network built on the AT Protocol (Bluesky).

## ✨ Features

- **Decentralized Identity** - You own your data on the AT Protocol
- **Federation** - Connect with users across the entire Bluesky network
- **Feed** - Cannect curated feed + Following timeline
- **Posts** - Create, like, repost, and reply with rich text & media
- **Profiles** - User profiles with followers/following
- **Search** - Search users and posts across the network
- **Notifications** - Real-time notifications
- **PWA Support** - Install on iOS/Android as a web app
- **Dark Theme** - Premium green & dark design

## 🛠️ Tech Stack

### Frontend
- **React Native** - Cross-platform mobile framework
- **Expo** (SDK 52) - Development platform
- **Expo Router** - File-based routing
- **NativeWind** - Tailwind CSS for React Native
- **TanStack Query** - Data fetching & caching
- **Zustand** - State management

### Backend (AT Protocol)
- **Personal Data Server (PDS)** - `cannect.space`
  - User accounts & authentication
  - Post storage (AT Protocol records)
  - Media blob storage
  - Federation with Bluesky network
- **Feed Generator** - Bluesky Feed Creator (hosted)
  - Curated cannabis content feed
  - No self-hosted VPS needed
- **AppView** - `api.bsky.app` (Bluesky infrastructure)
  - Global search & discovery
  - Notification routing
  - Content indexing

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/hemanthvishnu/cannect.git
   cd cannect
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

4. **Run on device/simulator**
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Press `w` for web browser
   - Scan QR code with Expo Go app

### Creating an Account

Accounts are created on the Cannect PDS (`cannect.space`):
- Your handle will be `username.cannect.space`
- You can also use a custom domain handle
- Your data is portable - you can migrate to any AT Protocol PDS

## 📁 Project Structure

```
cannect/
├── app/                    # Expo Router pages
│   ├── (auth)/            # Auth screens
│   │   ├── welcome.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (tabs)/            # Main tab screens
│   │   ├── feed.tsx       # Cannect + Following feeds
│   │   ├── search.tsx     # User & post search
│   │   ├── compose.tsx    # Create post
│   │   ├── notifications.tsx
│   │   └── profile.tsx    # Own profile
│   ├── post/[did]/[rkey].tsx  # Thread view
│   └── user/[handle].tsx      # User profile
├── components/
│   ├── social/            # Social feature components
│   ├── ui/                # Reusable UI components
│   ├── Post/              # Post display components
│   └── Profile/           # Profile components
├── lib/
│   ├── atproto/           # AT Protocol agent
│   │   └── agent.ts       # BskyAgent singleton
│   ├── hooks/             # React Query hooks
│   │   ├── use-atp-auth.ts
│   │   ├── use-atp-feed.ts
│   │   └── use-atp-profile.ts
│   ├── stores/            # Zustand stores
│   │   └── auth-store-atp.ts
│   ├── types/             # TypeScript types
│   └── query-client.ts    # TanStack Query config
├── public/                # PWA assets
│   ├── manifest.json
│   └── sw.js              # Service worker
├── scripts/
│   └── push-vps/          # Web push notification server
└── tailwind.config.js     # NativeWind theme
```

## 🎨 Theme

Premium dark theme with emerald green accents:

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | `#10B981` | Buttons, links, accents |
| Background | `#0A0A0A` | Main background |
| Surface | `#141414` | Cards, modals |
| Text Primary | `#FAFAFA` | Headings |
| Text Secondary | `#A1A1A1` | Captions |

## 📱 Scripts

```bash
npm start          # Start Expo dev server
npm run android    # Run on Android
npm run ios        # Run on iOS
npm run web        # Run on web
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript check
```

## 🌐 AT Protocol Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  Cannect App    │◄───────►│  cannect.space  │
│  (This repo)    │         │  (Our PDS)      │
└─────────────────┘         └────────┬────────┘
                                     │
                            Federation (firehose)
                                     │
                                     ▼
                            ┌─────────────────┐
                            │  Bluesky Relay  │
                            │  + AppView      │
                            │  api.bsky.app   │
                            └─────────────────┘
```

- **PDS (Personal Data Server)** - Stores user data, handles auth
- **Relay** - Aggregates data from all PDS instances
- **AppView** - Indexes content for search and feeds
- **Feed Generator** - Custom algorithms for curated feeds

## 🔧 Development

### Adding a new screen

1. Create a file in `app/` directory
2. Export a default React component
3. The route is automatically created by Expo Router

### Using AT Protocol hooks

```tsx
import { useTimeline, useCreatePost, useProfile } from "@/lib/hooks";

// Get feed
const { data, fetchNextPage } = useTimeline();

// Create a post
const createPost = useCreatePost();
await createPost.mutateAsync({ text: "Hello Cannect! 🌿" });

// Get a profile
const { data: profile } = useProfile("user.cannect.space");
```

### Styling with NativeWind

```tsx
<View className="bg-surface rounded-xl p-4 border border-border">
  <Text className="text-text-primary font-semibold">Hello!</Text>
</View>
```

## 📄 License

MIT License - feel free to use this for your own projects!

---

Built with 💚 on the AT Protocol

**Version:** 2.0.0 | **PDS:** cannect.space | **Feeds:** Bluesky Feed Creator
