import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface AuthContextType {
  isCheckingAuth: boolean;
  isAuthenticated: boolean;
  username: string | null;
  permissions: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isCheckingAuth: true,
  isAuthenticated: false,
  username: null,
  permissions: null,
  login: async () => {},
  logout: async () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [username, setUsername] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check authentication status on initial load
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await axios.get('/api/validate-session');
        if (response.data.isAuthenticated) {
          setIsAuthenticated(true);
          setUsername(response.data.username);
          setPermissions(response.data.permissions);
        }
      } catch {
        // Not authenticated, which is fine
        setIsAuthenticated(false);
      }
      setIsCheckingAuth(false);
    };

    checkAuth();
  }, []);

  // Login function
  const login = async (username: string, password: string) => {
    const response = await axios.post('/api/login', {
      username,
      password
    });

    if (response.data.success) {
      setUsername(response.data.username);
      setPermissions(response.data.permissions);
      setIsAuthenticated(true);
    }
  };

  // Logout function
  const logout = async () => {
    try {
      await axios.post('/api/logout');
    } catch (error) {
      console.error('Logout API failed:', error);
    }

    // Clear local state
    setUsername(null);
    setPermissions(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ 
      isCheckingAuth,
      isAuthenticated, 
      username, 
      permissions,
      login,
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
} 