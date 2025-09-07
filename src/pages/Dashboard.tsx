import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { motion } from "framer-motion";
import { 
  Video, 
  Calendar, 
  Users, 
  Heart, 
  Phone, 
  MessageCircle, 
  Clock,
  UserPlus,
  Settings,
  LogOut,
  Activity
} from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [isAppointmentOpen, setIsAppointmentOpen] = useState(false);
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [connectRelationship, setConnectRelationship] = useState<string>("");

  const rooms = useQuery(api.rooms.getUserRooms);
  const connections = useQuery(api.connections.getMyConnections);
  const pendingRequests = useQuery(api.connections.getPendingRequests);
  const appointments = useQuery(api.appointments.getMyAppointments);
  const notifications = useQuery(api.notifications.getMyNotifications);

  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const requestConnection = useMutation(api.connections.requestConnection);
  const approveConnection = useMutation(api.connections.approveConnection);
  const createAppointment = useMutation(api.appointments.createAppointment);
  const startAppointment = useMutation(api.appointments.startAppointment);
  const initiateCall = useMutation(api.connections.initiateCall);
  const sendMessageToConnection = useMutation(api.connections.sendMessageToConnection);
  const markNotificationRead = useMutation(api.notifications.markAsRead);

  const shownNotifsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!notifications) return;
    notifications.forEach((n: any) => {
      if (shownNotifsRef.current.has(n._id)) return;
      shownNotifsRef.current.add(n._id);

      if (n.type === "call" && n.roomId) {
        toast(`${n.title}`, {
          description: n.body,
          action: {
            label: "Join",
            onClick: async () => {
              try {
                await markNotificationRead({ notificationId: n._id });
              } catch {}
              navigate(`/room/${n.roomId}`);
            },
          },
        });
      } else if (n.type === "message") {
        toast(`${n.title}`, { description: n.body });
      }
    });
  }, [notifications, markNotificationRead, navigate]);

  const handleCreateRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    try {
      const roomId = await createRoom({
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        roomType: formData.get("roomType") as "consultation" | "monitoring" | "family",
        maxParticipants: parseInt(formData.get("maxParticipants") as string) || 10,
      });
      
      toast.success("Room created successfully!");
      setIsCreateRoomOpen(false);
      navigate(`/room/${roomId}`);
    } catch (error) {
      toast.error("Failed to create room");
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    try {
      await joinRoom({ roomId: roomId as any });
      navigate(`/room/${roomId}`);
    } catch (error) {
      toast.error("Failed to join room");
    }
  };

  const handleRequestConnection = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const patientEmail = String(formData.get("patientEmail") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    const relationshipVal = connectRelationship.trim();
    if (!relationshipVal) {
      toast.error("Please select a relationship");
      return;
    }

    try {
      await requestConnection({
        patientEmail,
        relationship: relationshipVal,
        notes,
      });

      toast.success("Connection request sent!");
      setIsConnectOpen(false);
      setConnectRelationship("");
    } catch (error) {
      toast.error("Failed to send connection request");
    }
  };

  const handleApproveConnection = async (connectionId: string) => {
    try {
      await approveConnection({ connectionId: connectionId as any });
      toast.success("Connection approved!");
    } catch (error) {
      toast.error("Failed to approve connection");
    }
  };

  const handleStartAppointment = async (appointmentId: string) => {
    try {
      const roomId = await startAppointment({ appointmentId: appointmentId as any });
      navigate(`/room/${roomId}`);
    } catch (error) {
      toast.error("Failed to start appointment");
    }
  };

  const handleCallConnection = async (connectionId: string) => {
    try {
      const roomId = await initiateCall({ connectionId: connectionId as any });
      toast.success("Calling...");
      navigate(`/room/${roomId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to initiate call");
    }
  };

  const openMessageDialog = (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    setMessageText("");
    setIsMessageOpen(true);
  };

  const handleSendMessageToConnection = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedConnectionId || !messageText.trim()) return;
    try {
      await sendMessageToConnection({
        connectionId: selectedConnectionId as any,
        content: messageText.trim(),
      });
      toast.success("Message sent");
      setIsMessageOpen(false);
      setMessageText("");
      setSelectedConnectionId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  const getRoleColor = (role?: string) => {
    switch (role) {
      case "patient": return "bg-blue-100 text-blue-800";
      case "relative": return "bg-green-100 text-green-800";
      case "healthcare_provider": return "bg-purple-100 text-purple-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled": return "bg-yellow-100 text-yellow-800";
      case "in_progress": return "bg-green-100 text-green-800";
      case "completed": return "bg-blue-100 text-blue-800";
      case "cancelled": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <img
                src="/logo.svg"
                alt="HealthConnect"
                className="h-8 w-8 cursor-pointer"
                onClick={() => navigate("/")}
              />
              <h1 className="text-xl font-semibold text-gray-900">HealthConnect</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <Badge className={getRoleColor(user?.role)}>
                {user?.role?.replace("_", " ") || "User"}
              </Badge>
              <span className="text-sm text-gray-700">{user?.name || user?.email}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut()}
                className="text-gray-500 hover:text-gray-700"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="shadow-md hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-blue-100 rounded-full">
                    <Video className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Start Video Call</h3>
                    <p className="text-sm text-gray-600">Connect with family or healthcare providers</p>
                  </div>
                </div>
                <Dialog open={isCreateRoomOpen} onOpenChange={setIsCreateRoomOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full mt-4 bg-blue-600 hover:bg-blue-700">
                      Create Room
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Create Video Room</DialogTitle>
                      <DialogDescription>
                        Set up a new video conference room for your session.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateRoom}>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="name">Room Name</Label>
                          <Input
                            id="name"
                            name="name"
                            placeholder="Family Visit - John Doe"
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="roomType">Room Type</Label>
                          <Select name="roomType" required>
                            <SelectTrigger>
                              <SelectValue placeholder="Select room type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="family">Family Visit</SelectItem>
                              <SelectItem value="consultation">Medical Consultation</SelectItem>
                              <SelectItem value="monitoring">Health Monitoring</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="description">Description (Optional)</Label>
                          <Textarea
                            id="description"
                            name="description"
                            placeholder="Brief description of the session..."
                          />
                        </div>
                        <div>
                          <Label htmlFor="maxParticipants">Max Participants</Label>
                          <Input
                            id="maxParticipants"
                            name="maxParticipants"
                            type="number"
                            defaultValue="10"
                            min="2"
                            max="50"
                          />
                        </div>
                      </div>
                      <DialogFooter className="mt-6">
                        <Button type="submit" className="w-full">
                          Create Room
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-green-100 rounded-full">
                    <UserPlus className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Connect Family</h3>
                    <p className="text-sm text-gray-600">Add family members to your care network</p>
                  </div>
                </div>
                <Dialog open={isConnectOpen} onOpenChange={(open) => { setIsConnectOpen(open); if (!open) setConnectRelationship(""); } }>
                  <DialogTrigger asChild>
                    <Button className="w-full mt-4 bg-green-600 hover:bg-green-700">
                      Add Connection
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Connect with Patient</DialogTitle>
                      <DialogDescription>
                        Send a connection request to a patient to join their care network.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleRequestConnection}>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="patientEmail">Patient Email</Label>
                          <Input
                            id="patientEmail"
                            name="patientEmail"
                            type="email"
                            placeholder="patient@example.com"
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="relationship">Relationship</Label>
                          <Select name="relationship" required value={connectRelationship} onValueChange={setConnectRelationship}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select relationship" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="spouse">Spouse</SelectItem>
                              <SelectItem value="child">Child</SelectItem>
                              <SelectItem value="parent">Parent</SelectItem>
                              <SelectItem value="sibling">Sibling</SelectItem>
                              <SelectItem value="friend">Friend</SelectItem>
                              <SelectItem value="caregiver">Caregiver</SelectItem>
                            </SelectContent>
                          </Select>
                          <input type="hidden" name="relationship" value={connectRelationship} />
                        </div>
                        <div>
                          <Label htmlFor="notes">Notes (Optional)</Label>
                          <Textarea
                            id="notes"
                            name="notes"
                            placeholder="Additional information..."
                          />
                        </div>
                      </div>
                      <DialogFooter className="mt-6">
                        <Button type="submit" className="w-full" disabled={!connectRelationship}>
                          Send Request
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-purple-100 rounded-full">
                    <Calendar className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Schedule Visit</h3>
                    <p className="text-sm text-gray-600">Plan upcoming appointments and visits</p>
                  </div>
                </div>
                <Button className="w-full mt-4 bg-purple-600 hover:bg-purple-700">
                  Schedule Appointment
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="rooms">Active Rooms</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="appointments">Appointments</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Active Rooms</p>
                      <p className="text-2xl font-bold text-gray-900">{rooms?.length || 0}</p>
                    </div>
                    <Video className="h-8 w-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Connections</p>
                      <p className="text-2xl font-bold text-gray-900">{connections?.filter(c => c.isApproved).length || 0}</p>
                    </div>
                    <Users className="h-8 w-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Pending Requests</p>
                      <p className="text-2xl font-bold text-gray-900">{pendingRequests?.length || 0}</p>
                    </div>
                    <Clock className="h-8 w-8 text-yellow-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Appointments</p>
                      <p className="text-2xl font-bold text-gray-900">{appointments?.length || 0}</p>
                    </div>
                    <Calendar className="h-8 w-8 text-purple-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Pending Connection Requests */}
            {pendingRequests && pendingRequests.length > 0 && (
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Clock className="h-5 w-5" />
                    <span>Pending Connection Requests</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {pendingRequests.map((request) => (
                      <div key={request._id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <p className="font-medium">{request.relative?.name || request.relative?.email}</p>
                          <p className="text-sm text-gray-600">Relationship: {request.relationship}</p>
                          {request.notes && (
                            <p className="text-sm text-gray-500 mt-1">{request.notes}</p>
                          )}
                        </div>
                        <Button
                          onClick={() => handleApproveConnection(request._id)}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Approve
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="rooms" className="space-y-6">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Active Video Rooms</CardTitle>
                <CardDescription>Join ongoing video conferences and monitoring sessions</CardDescription>
              </CardHeader>
              <CardContent>
                {rooms && rooms.length > 0 ? (
                  <div className="space-y-4">
                    {rooms.map((room) => (
                      <div key={room._id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">{room.name}</h3>
                          <p className="text-sm text-gray-600">{room.description}</p>
                          <Badge className="mt-2">{room.roomType}</Badge>
                        </div>
                        <Button
                          onClick={() => handleJoinRoom(room._id)}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          <Video className="h-4 w-4 mr-2" />
                          Join Room
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No active rooms. Create a new room to get started.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="connections" className="space-y-6">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Family & Care Network</CardTitle>
                <CardDescription>Manage your connections with patients and family members</CardDescription>
              </CardHeader>
              <CardContent>
                {connections && connections.length > 0 ? (
                  <div className="space-y-4">
                    {connections.filter(c => c.isApproved).map((connection) => (
                      <div key={connection._id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">
                            {connection.isPatient 
                              ? connection.relative?.name || connection.relative?.email
                              : connection.patient?.name || connection.patient?.email
                            }
                          </h3>
                          <p className="text-sm text-gray-600">
                            {connection.isPatient ? `Your ${connection.relationship}` : `Patient (${connection.relationship})`}
                          </p>
                          <Badge className={connection.isPatient ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}>
                            {connection.isPatient ? "Family Member" : "Patient"}
                          </Badge>
                        </div>
                        <div className="flex space-x-2">
                          <Button size="sm" variant="outline" onClick={() => openMessageDialog(connection._id)}>
                            <MessageCircle className="h-4 w-4 mr-2" />
                            Message
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleCallConnection(connection._id)}>
                            <Video className="h-4 w-4 mr-2" />
                            Call
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No connections yet. Add family members to get started.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appointments" className="space-y-6">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Upcoming Appointments</CardTitle>
                <CardDescription>View and manage your scheduled visits and consultations</CardDescription>
              </CardHeader>
              <CardContent>
                {appointments && appointments.length > 0 ? (
                  <div className="space-y-4">
                    {appointments.map((appointment) => (
                      <div key={appointment._id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <h3 className="font-medium">{appointment.title}</h3>
                          <p className="text-sm text-gray-600">
                            {new Date(appointment.scheduledTime).toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500">{appointment.duration} minutes</p>
                          <div className="flex items-center space-x-2 mt-2">
                            <Badge className={getStatusColor(appointment.status)}>
                              {appointment.status}
                            </Badge>
                            <Badge variant="outline">{appointment.type}</Badge>
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          {appointment.status === "scheduled" && (
                            <Button
                              onClick={() => handleStartAppointment(appointment._id)}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Video className="h-4 w-4 mr-2" />
                              Start
                            </Button>
                          )}
                          {appointment.status === "in_progress" && appointment.roomId && (
                            <Button
                              onClick={() => navigate(`/room/${appointment.roomId}`)}
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Video className="h-4 w-4 mr-2" />
                              Join
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No appointments scheduled.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="space-y-6">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Health Monitoring</span>
                </CardTitle>
                <CardDescription>Real-time health data and monitoring sessions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 border rounded-lg text-center">
                    <Heart className="h-8 w-8 text-red-500 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Heart Rate</p>
                    <p className="text-2xl font-bold">72 BPM</p>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <Activity className="h-8 w-8 text-blue-500 mx-auto mb-2" />
                    <p className="text-sm text-gray-600">Blood Pressure</p>
                    <p className="text-2xl font-bold">120/80</p>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <div className="h-8 w-8 bg-green-500 rounded-full mx-auto mb-2 flex items-center justify-center">
                      <span className="text-white text-xs">O₂</span>
                    </div>
                    <p className="text-sm text-gray-600">Oxygen</p>
                    <p className="text-2xl font-bold">98%</p>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <div className="h-8 w-8 bg-orange-500 rounded-full mx-auto mb-2 flex items-center justify-center">
                      <span className="text-white text-xs">°F</span>
                    </div>
                    <p className="text-sm text-gray-600">Temperature</p>
                    <p className="text-2xl font-bold">98.6°F</p>
                  </div>
                </div>
                <div className="mt-6">
                  <Button className="w-full bg-red-600 hover:bg-red-700">
                    <Activity className="h-4 w-4 mr-2" />
                    Start Monitoring Session
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={isMessageOpen} onOpenChange={setIsMessageOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Send a message</DialogTitle>
              <DialogDescription>Send a quick message to your connection.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSendMessageToConnection}>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="messageText">Message</Label>
                  <Textarea
                    id="messageText"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type your message..."
                    required
                  />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button type="submit" disabled={!messageText.trim()}>
                  Send
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}