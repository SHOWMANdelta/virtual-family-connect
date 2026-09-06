import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import {
  Video,
  Heart,
  Users,
  Shield,
  Mail,
  Monitor,
  MessageCircle,
  Calendar,
  ArrowRight,
  CheckCircle,
  Star,
  Play
} from "lucide-react";
import { useNavigate } from "react-router";

export default function Landing() {
  const { isLoading, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  const handleGetStarted = () => {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      navigate("/auth");
    }
  };

  // Add: robust smooth scroll helper for nav buttons
  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // Fallback to hash navigation if element not found
      window.location.hash = sectionId;
    }
  };

  const features = [
    {
      icon: Video,
      title: "Face-to-Face Video",
      description: "Clear video and audio in the browser, with mute, camera controls, and screen sharing built in",
      color: "bg-blue-100 text-blue-600"
    },
    {
      icon: Users,
      title: "Your Family Circle",
      description: "Connect relatives by email, set the relationship, and approve who joins your circle",
      color: "bg-purple-100 text-purple-600"
    },
    {
      icon: Mail,
      title: "Invite by Email",
      description: "Send a secure join link that drops the person you invited straight into the right room",
      color: "bg-red-100 text-red-600"
    },
    {
      icon: Shield,
      title: "Private by Invitation",
      description: "Rooms are invite-only, connection requests need approval, and join links expire",
      color: "bg-green-100 text-green-600"
    },
    {
      icon: Calendar,
      title: "Scheduled Visits",
      description: "Book a visit ahead of time and open the room for everyone when it's time to start",
      color: "bg-indigo-100 text-indigo-600"
    },
    {
      icon: MessageCircle,
      title: "Chat and Call Alerts",
      description: "Message anyone in your circle, and get an alert the moment someone calls you",
      color: "bg-orange-100 text-orange-600"
    }
  ];

  const testimonials = [
    {
      name: "Sarah Johnson",
      role: "Daughter",
      content: "Mum's care home is two hours away. We have a call every Sunday now, and my kids get to see their grandmother's face instead of just hearing her voice.",
      rating: 5
    },
    {
      name: "Michael Chen",
      role: "Patient",
      content: "After my surgery I couldn't have visitors for a fortnight. Being able to see everyone on the screen made the ward feel a lot less lonely.",
      rating: 5
    },
    {
      name: "Maria Rodriguez",
      role: "Care Coordinator",
      content: "Setting up a room and emailing the family a link takes about a minute. Relatives who aren't confident with technology manage it just fine.",
      rating: 5
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-600 rounded-lg shadow-md">
                <img
                  src="/logo.svg"
                  alt="Virtual Family Connect"
                  className="h-6 w-6 text-white"
                />
              </div>
              <span className="text-xl font-bold text-gray-900">Virtual Family Connect</span>
            </div>
            
            <div className="hidden md:flex items-center space-x-8">
              <a
                id="featuresBtn"
                href="#features"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection("features");
                }}
                className="text-gray-600 hover:text-blue-600 transition-colors"
              >
                Features
              </a>
              <a
                id="howItWorksBtn"
                href="#how-it-works"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection("how-it-works");
                }}
                className="text-gray-600 hover:text-blue-600 transition-colors"
              >
                How It Works
              </a>
              <a
                id="testimonialsBtn"
                href="#testimonials"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection("testimonials");
                }}
                className="text-gray-600 hover:text-blue-600 transition-colors"
              >
                Testimonials
              </a>
            </div>

            <div className="flex items-center space-x-4">
              {!isLoading && (
                <>
                  {isAuthenticated ? (
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-gray-600">Welcome, {user?.name || user?.email}</span>
                      <Button onClick={() => navigate("/dashboard")} className="bg-blue-600 hover:bg-blue-700 shadow-md">
                        Dashboard
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button variant="ghost" onClick={() => navigate("/auth")} className="text-gray-600 hover:text-blue-600">
                        Sign In
                      </Button>
                      <Button onClick={handleGetStarted} className="bg-blue-600 hover:bg-blue-700 shadow-md">
                        Get Started
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h1 className="text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6">
                Be There,
                <span className="text-blue-600"> Face to Face</span>
              </h1>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Set up a private video room, invite your family by email, and see
                each other properly — from the browser you already have open.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all duration-300 text-lg px-8 py-4"
                >
                  {isAuthenticated ? "Go to Dashboard" : "Get Started Free"}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => scrollToSection("how-it-works")}
                  className="border-2 border-blue-600 text-blue-600 hover:bg-blue-50 text-lg px-8 py-4"
                >
                  <Play className="mr-2 h-5 w-5" />
                  See How It Works
                </Button>
              </div>

              <div className="flex items-center space-x-6 text-sm text-gray-500">
                <div className="flex items-center">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                  Invite-only rooms
                </div>
                <div className="flex items-center">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                  Works in your browser
                </div>
                <div className="flex items-center">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                  Nothing to install
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative"
            >
              <div className="relative bg-white rounded-2xl shadow-2xl p-8 border border-gray-200">
                <div className="aspect-video bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl mb-6 flex items-center justify-center">
                  <div className="text-center">
                    <Video className="h-16 w-16 text-blue-600 mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Live Video Session</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <Users className="h-6 w-6 text-blue-500 mx-auto mb-2" />
                    <p className="text-xs text-gray-600">In the room</p>
                    <p className="font-semibold">3 joined</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <Monitor className="h-6 w-6 text-purple-500 mx-auto mb-2" />
                    <p className="text-xs text-gray-600">Screen share</p>
                    <p className="font-semibold">Ready</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <MessageCircle className="h-6 w-6 text-green-500 mx-auto mb-2" />
                    <p className="text-xs text-gray-600">Chat</p>
                    <p className="font-semibold">On</p>
                  </div>
                </div>
              </div>
              
              {/* Floating elements */}
              <div className="absolute -top-4 -right-4 bg-green-500 text-white p-3 rounded-full shadow-lg">
                <CheckCircle className="h-6 w-6" />
              </div>
              <div className="absolute -bottom-4 -left-4 bg-blue-500 text-white p-3 rounded-full shadow-lg">
                <Users className="h-6 w-6" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Everything You Need to Be Together
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Private video rooms, email invites, scheduled visits, and chat —
              everything it takes to keep a family in touch, in one place.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className="h-full hover:shadow-lg transition-shadow duration-300 border-0 shadow-md">
                  <CardHeader>
                    <div className={`w-12 h-12 rounded-lg ${feature.color} flex items-center justify-center mb-4`}>
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <CardTitle className="text-xl font-semibold text-gray-900">
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-gray-600 text-base leading-relaxed">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Three Steps to Your First Visit
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Set up in minutes, on a platform simple enough for every generation to use.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Sign Up & Connect",
                description: "Create your account, then send a connection request to a family member using their email address.",
                icon: Users
              },
              {
                step: "2",
                title: "Schedule or Start",
                description: "Start a call straight away, or book a visit for later and email everyone a join link.",
                icon: Calendar
              },
              {
                step: "3",
                title: "Sit Down Together",
                description: "Talk face to face, share your screen to show photos or paperwork, and keep chatting on the side.",
                icon: Heart
              }
            ].map((step, index) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                viewport={{ once: true }}
                className="text-center"
              >
                <div className="relative mb-8">
                  <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg">
                    {step.step}
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                    <step.icon className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4">{step.title}</h3>
                <p className="text-gray-600 leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              What Families Are Saying
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              How Virtual Family Connect helps people stay close to the ones they love.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.name}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className="h-full shadow-md hover:shadow-lg transition-shadow duration-300">
                  <CardContent className="p-6">
                    <div className="flex items-center mb-4">
                      {[...Array(testimonial.rating)].map((_, i) => (
                        <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                      ))}
                    </div>
                    <p className="text-gray-600 mb-6 leading-relaxed italic">
                      "{testimonial.content}"
                    </p>
                    <div>
                      <p className="font-semibold text-gray-900">{testimonial.name}</p>
                      <p className="text-sm text-gray-500">{testimonial.role}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl font-bold text-white mb-6">
              Ready to See Them Again?
            </h2>
            <p className="text-xl text-blue-100 mb-8 leading-relaxed">
              Create a room, send your family a link, and have your first call in the next five minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-white text-blue-600 hover:bg-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 text-lg px-8 py-4"
              >
                {isAuthenticated ? "Go to Dashboard" : "Create Your Free Account"}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => scrollToSection("features")}
                className="border-2 border-white text-white hover:bg-white hover:text-blue-600 text-lg px-8 py-4"
              >
                <Video className="mr-2 h-5 w-5" />
                See the Features
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <img src="/logo.svg" alt="Virtual Family Connect" className="h-6 w-6" />
                </div>
                <span className="text-xl font-bold">Virtual Family Connect</span>
              </div>
              <p className="text-gray-400 leading-relaxed">
                Private video rooms that keep families face to face, wherever life has put them.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Integrations</a></li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-4">Support</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">System Status</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Training</a></li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2026 Virtual Family Connect. All rights reserved. Built with ❤️ to keep families close.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}