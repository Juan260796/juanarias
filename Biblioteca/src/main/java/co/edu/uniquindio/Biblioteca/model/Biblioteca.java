package co.edu.uniquindio.Biblioteca.model;
import java.util.ArrayList;
import java.util.List;

public class Biblioteca {
    private String nombre;

    private List<Usuario> listaUsuarios= new ArrayList<>();
    private List<Prestamo> listaPrestamos= new ArrayList<>();
    private List<Libro> listaLibros= new ArrayList<>();
    private List<Bibliotecario> listaBibliotecario= new ArrayList<>();

    public Biblioteca(){
    }

    public String getNombre() {

        return nombre;
    }

    public void setNombre(String nombre){

        this.nombre= nombre;
    }

    public List<Libro> getListaLibros(){

        return listaLibros;
    }

    public void setListaLibros(List<Libro>listaLibros){
        this.listaLibros= listaLibros;

    }

    public List<Usuario> getListaUsuarios(){
        return listaUsuarios;

    }

    public void setListaUsuarios (List<Usuario> listaUsuarios){
        this.listaUsuarios= listaUsuarios;

    }

    public List<Prestamo> getListaPrestamos(){
        return listaPrestamos;

    }

    public void setListaPrestamos (List<Prestamo> listaPrestamos){
        this.listaPrestamos= listaPrestamos;
    }

    public List<Bibliotecario> getListaBibliotecario(){
        return listaBibliotecario;

    }

    public void SetListaBibliotecario (List<Bibliotecario> listaBibliotecario) {
        this.listaBibliotecario = listaBibliotecario;

    }

}
