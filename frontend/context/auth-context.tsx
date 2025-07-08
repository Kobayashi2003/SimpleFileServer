import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface AuthContextType {
  isCheckingAuth: boolean;
  isAuthenticated: boolean;
  token: string | null;
  username: string | null;
  permissions: string | null;
  login: (token: string, username: string, permissions: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isCheckingAuth: true,
  isAuthenticated: false,
  token: null,
  username: null,
  permissions: null,
  login: () => {},
  logout: () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Load token from localStorage on initial load
  useEffect(() => {

    const validateToken = async (token: string) => {
      try {
        const response = await axios.get('/api/validate-token', {
          headers: { Authorization: `Basic ${token}` }
        });
        return response.data.isAuthenticated;
      } catch {
        return false;
      }
    }

    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('auth_token');
      const storedUsername = localStorage.getItem('auth_username');
      const storedPermissions = localStorage.getItem('auth_permissions');

      if (storedToken) {
        const isValid = await validateToken(storedToken);

        if (isValid) {
          setToken(storedToken);
          setUsername(storedUsername);
          setPermissions(storedPermissions);
          setIsAuthenticated(true);
          axios.defaults.headers.common['Authorization'] = `Basic ${storedToken}`;
        } else {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_username');
          localStorage.removeItem('auth_permissions');
          delete axios.defaults.headers.common['Authorization'];
        }
      }
      setIsCheckingAuth(false);
    }

    initializeAuth();
  }, []);

  // Login function
  const login = (newToken: string, newUsername: string, newPermissions: string) => {
    setToken(newToken);
    setUsername(newUsername);
    setPermissions(newPermissions);
    setIsAuthenticated(true);
    
    // Store in localStorage
    localStorage.setItem('auth_token', newToken);
    localStorage.setItem('auth_username', newUsername);
    localStorage.setItem('auth_permissions', newPermissions);
    
    // Set for future requests
    axios.defaults.headers.common['Authorization'] = `Basic ${newToken}`;
  };

  // Logout function
  const logout = () => {
    setToken(null);
    setUsername(null);
    setPermissions(null);
    setIsAuthenticated(false);
    
    // Remove from localStorage
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
    localStorage.removeItem('auth_permissions');
    
    // Remove from future requests
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ 
      isCheckingAuth,
      isAuthenticated, 
      token, 
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